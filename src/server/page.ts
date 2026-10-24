// What the page reads (the summary, shelves, rows in full, search, the History row).
import { cardsOf, viewsOf } from './cards';
import { q } from './db';
import { forYouOf } from './foryou';
import { resumeCards } from './resume';
import { watchingCards } from './watching';
import { asTmdb } from './mapping';
import { ROWS, SERVICES, SERVICE_ROWS, listOf, liveServices, rowType, rowsNow, serviceRowKind } from './rows';
import { kitsu, tmdb } from './sources';
import { liveOf, metaGet, metaSet, watchKeys } from './store';
import { GENRE_OPTIONS, fillFromTmdb, fromKitsu, fromTmdb, genresOf, saveTitles, titlesOf } from './titles';
import type { KitsuList, LiveValue, Title, TitleType, TmdbPage, Uid, View } from './types';
import { HOUR, present } from './util';

// ---------- search: movies and TV from TMDB, anime from Kitsu ----------
export async function search(text: string, uid: Uid) {
  const [tm, ki] = await Promise.all([
    tmdb<TmdbPage>(`/search/multi?query=${encodeURIComponent(text)}&include_adult=false`).catch((): TmdbPage => ({ results: [] })),
    kitsu<KitsuList>(`/anime?filter[text]=${encodeURIComponent(text)}&page[limit]=8`).catch((): KitsuList => ({ data: [] })),
  ]);
  const a = tm.results.filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 14).map((x) => fromTmdb(x.media_type as 'movie' | 'tv')(x));
  const b = await asTmdb(await fillFromTmdb(ki.data.map(fromKitsu)));
  const seen = new Set<string>();
  const list = await saveTitles([...a, ...b].filter((t) => t && !seen.has(t.key) && seen.add(t.key)));
  const ts = await titlesOf(list.map((t) => t.key));
  return viewsOf(uid, list.map((t) => ts.get(t.key) || null), await watchKeys(uid));
}

// the History row: every title watched in the last N days, newest first, with its latest play, the play count and your rating
// of that play (the episode, or the movie)
async function recent(uid: string, days = 30) {
  type R = { key: string; season: number; episode: number; watched_at: number; source: string; title: string; label: string | null; type: TitleType; poster: string | null; backdrop: string | null };
  const rows = await q.all<R>(`select h.key, h.season, h.episode, h.watched_at, h.source, t.title, t.label, t.type, t.poster, t.backdrop
    from history h join titles t using (key) where h.user_id = ? and h.watched_at >= ? and h.approx != 1 order by h.watched_at desc`, uid, Date.now() - days * 86400000);
  const mine = new Map((await q.all<{ key: string; season: number; episode: number; rating: number }>('select key, season, episode, rating from ratings where user_id = ?', uid)).map((r) => [`${r.key}|${r.season}|${r.episode}`, r.rating]));
  const out = new Map<string, Omit<R, 'watched_at'> & { at: number; plays: number; mine: number | null }>();
  for (const r of rows) {
    const o = out.get(r.key);
    if (o) { o.plays++; continue; }
    out.set(r.key, { key: r.key, title: r.title, label: r.label, type: r.type, poster: r.poster, backdrop: r.backdrop,
      season: r.season, episode: r.episode, at: r.watched_at, source: r.source, plays: 1, mine: mine.get(`${r.key}|${r.season}|${r.episode}`) || null });
  }
  return [...out.values()].slice(0, 40);
}
// Continue watching cards you marked watched here stay away until Stremio has newer progress for them (Stremio itself
// still lists them)
async function hideDone(uid: string, sr: LiveValue['stremio']) {
  if (!sr) return sr;
  const hidden = new Map((await q.all<{ item: string; state: { at?: number } | null }>("select item, state from sync_state where user_id = ? and source = 'cw-hide'", uid)).map((r) => [r.item, r.state?.at ?? -1]));
  return { ...sr, continue: (sr.continue || []).filter((c) => !(c.resume && (hidden.get(`${c.id}|${c.video || ''}`) ?? -1) >= c.at)) };
}
// the page's summary (asked every 15 s): Stremio's live parts, what a player says is playing, Up next, the calendar, Home's rows
// and For you
export async function pageData(uid: string, query: URLSearchParams) {
  const l = await liveOf(uid);
  return { stremio: await hideDone(uid, l.stremio), watching: await watchingCards(uid), resume: await resumeCards(uid), upNext: l.upNext || [], schedule: l.schedule || [], media: await summary(uid, query),
    forYou: await forYouOf(uid) };
}
// the home page's two pickers, each with Movies | Shows | Anime: a group of the general rows (Everyone, Kids) (In theaters stays a row of its own) and a
// streaming service. The page gets the picked pair's two rows only; a switch asks for the next pair (/api/shelf)
type Kind = 'movie' | 'tv' | 'anime';
// the group picker's kinds: the Anime page also picks anime films (no kids rows of those)
type GroupKind = Kind | 'anime-movie';
const GROUPS: Record<string, Record<GroupKind, string[]>> = { everyone: { movie: ['movie-trending', 'movie-popular'], tv: ['tv-trending', 'tv-popular'], anime: ['anime-trending', 'anime-popular'], 'anime-movie': ['anime-movie-trending', 'anime-movie-popular'] },
  kids: { movie: ['kids-movie-trending', 'kids-movie-popular'], tv: ['kids-tv-trending', 'kids-tv-popular'], anime: ['kids-anime-trending', 'kids-anime-popular'], 'anime-movie': [] } };
// rows of their own, each on its kind's page (in ROWS' order): Movies' In theaters, Box office, New on streaming, Coming soon;
// TV's New episodes this week, Returning shows, New shows, Premiering soon; Anime's Airing this week, Returning anime, Next season,
// Top rated
const ALONE = ['theaters', 'movie-box-office', 'movie-streaming-new', 'movie-coming', 'tv-new-episodes', 'tv-returning', 'tv-new-shows', 'tv-premieres',
  'anime-this-week', 'anime-returning', 'anime-next-season', 'anime-top-rated'];
const kindOf = (k: string | null | undefined): Kind => (k === 'tv' || k === 'anime' ? k : 'movie');
const groupKindOf = (k: string | null | undefined): GroupKind => (k === 'anime-movie' ? k : kindOf(k));
// a service has a kind when one of its rows of that kind has titles
const hasKind = (services: Awaited<ReturnType<typeof rowsNow>>['services'], id: string, kind: GroupKind) =>
  !(SERVICES.find((s) => s.id === id)?.anime && (kind === 'movie' || kind === 'tv')) && SERVICE_ROWS.some((r) => serviceRowKind(r.id) === kind && !!services[id]?.[r.id]?.length);
type RowCards = { id: string; kind?: string; title: string; items: View[]; total?: number };
type Shelves = { group?: { id: string; kind: GroupKind; rows: RowCards[] }; service?: { id: string; kind: GroupKind; rows: RowCards[] } | null };
// p: { group, gkind, svc, skind }; a group or service left null isn't sent
export async function shelves(uid: Uid, p: { group?: string | null; gkind?: string | null; svc?: string | null; skind?: string | null }, wl?: Set<string>) {
  wl ||= await watchKeys(uid);
  const { rows, services } = await rowsNow();
  const out: Shelves = {};
  if (p.group != null) {
    const id = GROUPS[p.group] ? p.group : 'everyone', kind = groupKindOf(p.gkind), group = { id, kind, rows: [] as RowCards[] };
    out.group = group;
    for (const r of GROUPS[id][kind].map((rid) => ROWS.find((x) => x.id === rid)!))
      group.rows.push({ id: r.id, title: r.title, items: await cardsOf(uid, listOf(rows, r.id).slice(0, r.page), wl), total: listOf(rows, r.id).length });
  }
  if (p.svc != null) {
    // only services with that kind's titles (most have no anime): the picked one, else the first of them
    // the Anime page keeps its services whether it shows series or films
    const kind = groupKindOf(p.skind), keep = (s: { id: string }) => hasKind(services, s.id, kind) || (kind.startsWith('anime') && (hasKind(services, s.id, 'anime') || hasKind(services, s.id, 'anime-movie')));
    const live = liveServices(services).filter(keep), sv = live.find((s) => s.id === p.svc) || live[0];
    if (sv) {
      const service = { id: sv.id, kind, rows: [] as RowCards[] };
      out.service = service;
      for (const r of SERVICE_ROWS.filter((x) => serviceRowKind(x.id) === kind))
        service.rows.push({ id: r.id, title: `${r.title} · ${sv.name}`, items: await cardsOf(uid, services[sv.id]?.[r.id] || [], wl) });
    } else out.service = null;
  }
  return out;
}
async function summary(uid: string, query = new URLSearchParams()) {
  const wl = await watchKeys(uid), { rows, services } = await rowsNow();
  const saved = await q.all<Title & { added_at: number }>('select t.*, w.added_at from watchlist w join titles t using (key) where w.user_id = ? order by w.added_at desc', uid);
  // anime: an anime title placed on its TMDB show is a 'tv' title, so the pages tell it by this
  const watchlist = (await viewsOf(uid, saved, wl)).map((v, i) => ({ ...v, addedAt: saved[i].added_at, anime: !!saved[i].anime }));
  const alone: RowCards[] = [];
  for (const r of ROWS.filter((x) => ALONE.includes(x.id))) alone.push({ id: r.id, kind: rowType(r.id) === 'series' ? 'tv' : rowType(r.id), title: r.title, items: await cardsOf(uid, listOf(rows, r.id).slice(0, r.page), wl), total: listOf(rows, r.id).length });
  return { rows: alone.filter((r) => r.items.length), rowsAt: rows.at,
    watchlist, recent: await recent(uid, 30),
    // kinds: which of movies, shows and anime a service has, so each page offers only the services with its kind
    services: liveServices(services).map((sv) => ({ id: sv.id, name: sv.name, logo: `https://image.tmdb.org/t/p/w92${sv.logo}`,
      kinds: (['movie', 'tv', 'anime', 'anime-movie'] as const).filter((k) => hasKind(services, sv.id, k)) })),
    ...await shelves(uid, { group: query.get('group') || 'everyone', gkind: query.get('gkind'), svc: query.get('svc') || '', skind: query.get('skind') }, wl) };
}
// a row in full for the page's See all (the page itself gets each row's first `page` titles), with each title's genres and the
// genres the row has, in the catalogs' order
// the Movies, TV and Anime pages' carousel: that kind's trending titles that have a wide image, with their story and genres
// (Animation says nothing on Anime)
const HERO_ROW: Record<TitleType, string> = { movie: 'movie-trending', tv: 'tv-trending', anime: 'anime-trending' };
export async function hero(kind: TitleType, uid: Uid) {
  const wl = await watchKeys(uid), keys = listOf((await rowsNow()).rows, HERO_ROW[kind]).slice(0, 20), ts = await titlesOf(keys);
  const list = keys.map((k) => ts.get(k)).filter((t): t is Title => !!t?.backdrop).slice(0, 8);
  return { items: (await viewsOf(uid, list, wl)).map((v, i) => ({ ...v, overview: list[i].overview, genres: genresOf(list[i]).filter((g) => kind !== 'anime' || g !== 'Animation').slice(0, 3) })) };
}
// also a streaming service's row (svc_<service>_<row>) and For you's two (foryou-suggested, foryou-coming), each as its own page
export async function rowAll(id: string, uid: Uid) {
  if (id === 'foryou-suggested' || id === 'foryou-coming') {
    const f = uid ? await forYouOf(uid) : null;
    return { id, title: id === 'foryou-coming' ? 'Coming soon' : 'Suggested', items: (id === 'foryou-coming' ? f?.coming : f?.suggested) || [], genres: [] };
  }
  const sm = id.match(/^svc_([a-z]+)_([\w-]+)$/), sv = sm && SERVICES.find((x) => x.id === sm[1]), sr = sm && SERVICE_ROWS.find((x) => x.id === sm[2]);
  const r = sm ? sr && sv && { id, title: `${sr.title} · ${sv.name}` } : ROWS.find((x) => x.id === id);
  if (!r) return null;
  const { rows, services } = await rowsNow();
  const wl = await watchKeys(uid), keys = sm ? services[sm[1]]?.[sm[2]] || [] : listOf(rows, id), ts = await titlesOf(keys);
  const list = keys.map((k) => ts.get(k)).filter(present);
  const items = (await viewsOf(uid, list, wl)).map((v, i) => ({ ...v, genres: genresOf(list[i]) }));
  const have = new Set(items.flatMap((x) => x.genres));
  return { id, title: r.title, items, genres: GENRE_OPTIONS[rowType(sm ? sm[2] : id)].filter((g) => have.has(g)) };
}

// the signed-out page's poster strip: trending movies, shows and anime in turn, 8 of each, picked once a week (meta 'landing')
// so every visit isn't a new pick; TMDB posters at w185, plenty for the strip's 93 px even on a sharp screen
export async function landingPosters() {
  const kept = await metaGet<{ at: number; posters: string[] }>('landing');
  if (kept?.posters?.length && Date.now() - kept.at < 7 * 24 * HOUR) return kept.posters;
  const { rows } = await rowsNow(), ids = ['movie-trending', 'tv-trending', 'anime-trending'];
  const ts = await titlesOf(ids.flatMap((id) => listOf(rows, id)));
  const lists = ids.map((id) => listOf(rows, id).map((k) => ts.get(k)?.poster).filter(present).slice(0, 8));
  const posters: string[] = [];
  for (let i = 0; i < 8; i++) for (const l of lists) if (l[i]) posters.push(l[i].replace('/t/p/w342/', '/t/p/w185/'));
  if (posters.length) await metaSet('landing', { at: Date.now(), posters });
  return posters;
}
