// Your lists (the Lists page, /api/lists): manual ones hold the titles you add; smart ones fill themselves from their filters
// with TMDB's discover (anime: Japanese animation shows), their titles kept in order and made again by the worker as often as
// their refresh says. Plan to watch, Watched and Rated are the built-in lists beside them. Every list is also offered to the
// Stremio addon (catalogs.ts reads it as list.<id>).
import crypto from 'node:crypto';
import { cardsOf } from './cards';
import { q } from './db';
import { prefsOf } from './region';
import { floorsOf, known, verdict, warm, type ScoreRule } from './scores';
import { homeReleases, type Home } from './athome';
import { tvdbCategory, tvdbOn } from './tvdb';
import { SERVICES } from './rows';
import { tmdb } from './sources';
import { metaGet, metaSet, watchKeys } from './store';
import { fromTmdb, genresOf, saveTitles, titlesOf } from './titles';
import type { Title, TmdbPage } from './types';
import { HOUR, present } from './util';

// a smart list's kind: movies, shows, anime series, anime films, or movies and shows together
export type Media = 'movie' | 'tv' | 'anime' | 'animefilm' | 'both';
export const MEDIA: Media[] = ['movie', 'tv', 'anime', 'animefilm', 'both'];
type Release = 'cinema' | 'digital' | 'disc' | 'tv';
// a smart list's filters (every field optional; the builder's groups)
export type Filters = {
  sort?: 'popular' | 'rating' | 'newest' | 'oldest' | 'az' | 'box' | 'votes' | 'shuffle' | 'release' | 'releaseOld'; max?: number; refresh?: 'daily' | 'weekly' | 'never';
  // row: shown as a row on Home and its kind's page
  row?: boolean;
  // home (Latest releases): what came out at home in the last homeWithin days (90 unset) in any of these ways, instead of TMDB's
  // search; homeCinema: only films that were in cinemas; sort release / releaseOld: by the day it came out at home
  home?: Home[]; homeWithin?: number; homeCinema?: boolean;
  genres?: string[]; without?: string[]; match?: 'any' | 'all';
  // when: a window that moves with each refresh, or years (yearFrom, yearTo); decades: their first years, any number of them
  when?: 'any' | '30d' | '6m' | 'year' | 'next3' | 'years'; yearFrom?: number; yearTo?: number; decades?: number[];
  runtimeFrom?: number; runtimeTo?: number; released?: 'out' | 'coming' | 'both'; cert?: string;
  out?: Release[]; status?: number[]; type?: number[];
  scoreFrom?: number; scoreTo?: number; votes?: number; votesTo?: number;
  // region: the list's country (release dates, age ratings, services); reach: titles released there (shows: made there), on its
  // services, or anywhere; services: TMDB provider ids (older lists: Listick's service ids); my: the user's own services instead
  region?: string; reach?: 'released' | 'streaming' | 'anywhere'; services?: (number | string)[]; my?: boolean; how?: 'flatrate' | 'free' | 'rent';
  // languages, countries: original language and where it was made, any of them (language, country: older lists' single ones)
  language?: string; country?: string; languages?: string[]; countries?: string[];
  // TMDB keywords, cast, crew (directors, writers), studios and networks; a keyword or studio with out is left out. Cast and crew
  // are films' only (TMDB's show search ignores them), networks shows' only
  mood?: string; keywords?: Picked[]; cast?: Picked[]; castMatch?: 'any' | 'all'; crew?: Picked[]; companies?: Picked[]; networks?: number[];
  hideWatched?: boolean; hidePlan?: boolean; onlyRated?: boolean;
  // your library (TMDB can't tell): titles you rated within myFrom–myTo, watched this year, over a year ago, or shows started and
  // not finished. Either makes the list from your library instead, with the filters titles carry here (kind, genres, years,
  // runtime, TMDB score)
  myFrom?: number; myTo?: number; watched?: 'year' | 'old' | 'started';
  // shows: a TheTVDB category (genre id) instead of TMDB's search
  tvdbGenre?: number;
} & ScoreRule;
type Picked = { id: number; name: string; out?: boolean };
type Row = { id: string; user_id: string; name: string; description: string | null; kind: 'manual' | 'smart'; media: Media | null; filters: Filters | null;
  items: string[] | null; shared: boolean; position: number; created_at: number; refreshed_at: number | null };

// TMDB's genre ids by the app's names, per kind (a show's Action is TMDB's Action & Adventure)
const MOVIE_G: Record<string, number> = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751,
  Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37 };
const TV_G: Record<string, number> = { Action: 10759, Adventure: 10759, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751,
  Fantasy: 10765, Kids: 10762, Mystery: 9648, Reality: 10764, 'Sci-Fi': 10765, War: 10768, Western: 37, Romance: 10749 };
// anime's own genres that TMDB has no genre for: its keywords instead
const ANIME_KW: Record<string, number> = { Isekai: 237451, Mecha: 10046, Psychological: 272553, School: 10873, 'Slice of Life': 9914, Sports: 6075, Supernatural: 6152 };
const ANIME_G = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Mystery', 'Romance', 'Sci-Fi', 'Family', ...Object.keys(ANIME_KW)];
const GENRES: Record<Media, string[]> = { movie: Object.keys(MOVIE_G), tv: Object.keys(TV_G).filter((g) => g !== 'Animation'),
  anime: ANIME_G, animefilm: ANIME_G, both: Object.keys(MOVIE_G).filter((g) => g in TV_G) };
// films' sort, shows' sort (shows have no box office: popular instead); shuffle reorders a popular pool at each refresh
const SORT: Record<Exclude<NonNullable<Filters['sort']>, 'release' | 'releaseOld'>, [string, string]> = { popular: ['popularity.desc', 'popularity.desc'], rating: ['vote_average.desc', 'vote_average.desc'],
  newest: ['primary_release_date.desc', 'first_air_date.desc'], oldest: ['primary_release_date.asc', 'first_air_date.asc'], az: ['title.asc', 'name.asc'],
  box: ['revenue.desc', 'popularity.desc'], votes: ['vote_count.desc', 'vote_count.desc'], shuffle: ['popularity.desc', 'popularity.desc'] };
// a film's release kinds (TMDB's with_release_type) and a show's status and type codes
const RELEASE: Record<Release, string> = { cinema: '2|3', digital: '4', disc: '5', tv: '6' };
const day = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number) => day(new Date(Date.now() + days * 86400000));

// the date windows a list asks for: when (moving, or its years), each of its decades within that (none: one open window)
type Window = { gte?: string; lte?: string };
function windows(f: Filters): Window[] {
  const y = new Date().getFullYear(), today = day(new Date());
  const when = f.when || (f.yearFrom || f.yearTo ? 'years' : 'any');
  const w: Window = when === '30d' ? { gte: plus(-30), lte: today } : when === '6m' ? { gte: plus(-182), lte: today } : when === 'year' ? { gte: `${y}-01-01`, lte: `${y}-12-31` }
    : when === 'next3' ? { gte: today, lte: plus(92) } : when === 'years' ? { gte: f.yearFrom ? `${f.yearFrom}-01-01` : undefined, lte: f.yearTo ? `${f.yearTo}-12-31` : undefined } : {};
  if (f.released === 'out' && (!w.lte || w.lte > today)) w.lte = today;
  if (f.released === 'coming' && (!w.gte || w.gte < today)) w.gte = today;
  if (!f.decades?.length) return [w];
  const max = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b), min = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);
  return [...new Set(f.decades)].sort().map((d) => ({ gte: max(w.gte, `${d}-01-01`), lte: min(w.lte, `${d + 9}-12-31`) })).filter((x) => !x.gte || !x.lte || x.gte <= x.lte);
}
// the list's services as TMDB provider ids: the user's own (mine), or those picked (older lists: Listick's service ids)
const providersOf = (f: Filters, mine: number[]) => (f.my ? mine : (f.services || []).flatMap((id) => (typeof id === 'number' ? [id] : SERVICES.find((s) => s.id === id)?.ids || [])));
// one discover query: films or shows (anime: Japanese animation, films or shows) within one date window
function discoverPath(type: 'movie' | 'tv', anime: boolean, f: Filters, w: Window, mine: number[]) {
  const movie = type === 'movie', ids = movie ? MOVIE_G : TV_G, q = new URLSearchParams({ include_adult: 'false', sort_by: (SORT[(f.sort || 'popular') as keyof typeof SORT] || SORT.popular)[movie ? 0 : 1] });
  const join = f.match === 'all' ? ',' : '|';
  const inc = [...new Set((f.genres || []).map((g) => ids[g]).filter(present))], out = [...new Set((f.without || []).map((g) => ids[g]).filter(present))];
  // anime: Japanese animation; with "any" genres TMDB can't also require Animation, so runSmart keeps only animated results
  if (anime) { q.set('with_original_language', 'ja'); if (!inc.length || f.match === 'all') inc.unshift(16); }
  if (inc.length) q.set('with_genres', [...new Set(inc)].join(join));
  if (out.length) q.set('without_genres', out.join(','));
  const region = /^[A-Z]{2}$/.test(f.region || '') ? f.region! : 'US', released = f.reach === 'released';
  // a film's release in that country (released there, or how it came out): its dates are the country's own; a show made there
  const kinds = movie && f.out?.length ? f.out.map((k) => RELEASE[k]).filter(present).join('|') : movie && released ? '2|3|4|5|6' : '';
  if (kinds) { q.set('region', region); q.set('with_release_type', kinds); }
  if (released && !movie && !f.countries?.length && !f.country) q.set('with_origin_country', region);
  const from = kinds ? 'release_date' : movie ? 'primary_release_date' : 'first_air_date';
  if (w.gte) q.set(`${from}.gte`, w.gte);
  if (w.lte) q.set(`${from}.lte`, w.lte);
  // TMDB applies a film's regional release only with a date bound, so a regional one always has one
  if (kinds && !w.gte && !w.lte) q.set('release_date.lte', `${new Date().getFullYear() + 5}-12-31`);
  if (!movie && f.status?.length) q.set('with_status', f.status.join('|'));
  if (!movie && f.type?.length) q.set('with_type', f.type.join('|'));
  if (f.runtimeFrom) q.set('with_runtime.gte', String(f.runtimeFrom));
  if (f.runtimeTo) q.set('with_runtime.lte', String(f.runtimeTo));
  if (movie && f.cert) { q.set('certification_country', region); q.set('certification.lte', f.cert); }
  if (f.scoreFrom) q.set('vote_average.gte', String(f.scoreFrom));
  if (f.scoreTo) q.set('vote_average.lte', String(f.scoreTo));
  // A–Z, oldest and top rated would open on titles hardly anyone has seen without a few votes
  q.set('vote_count.gte', String(f.votes ?? (f.sort === 'rating' ? 200 : f.sort === 'az' || f.sort === 'oldest' ? 50 : 0)));
  if (f.votesTo) q.set('vote_count.lte', String(f.votesTo));
  const prov = providersOf(f, mine);
  if (prov.length || f.reach === 'streaming') {
    q.set('watch_region', region); q.set('with_watch_monetization_types', f.how === 'free' ? 'free|ads' : f.how === 'rent' ? 'rent|buy' : 'flatrate');
    if (prov.length) q.set('with_watch_providers', prov.join('|'));
  }
  const langs = f.languages?.length ? f.languages : f.language ? [f.language] : [], lands = f.countries?.length ? f.countries : f.country ? [f.country] : [];
  if (langs.length && !anime) q.set('with_original_language', langs.join('|'));
  if (lands.length) q.set('with_origin_country', lands.join('|'));
  const picked = (l: Picked[] | undefined, out: boolean) => (l || []).filter((x) => !!x.out === out && Number.isInteger(x.id)).map((x) => x.id);
  // an anime's own genres go in as keywords (with the genres' any or all), beside the keywords picked
  const kw = (names: string[] | undefined) => (anime ? (names || []).map((g) => ANIME_KW[g]).filter(present) : []);
  const withKw = [...kw(f.genres), ...picked(f.keywords, false)], withoutKw = [...kw(f.without), ...picked(f.keywords, true)];
  if (withKw.length) q.set('with_keywords', withKw.join(kw(f.genres).length && f.match === 'all' ? ',' : '|'));
  if (withoutKw.length) q.set('without_keywords', withoutKw.join(','));
  if (picked(f.companies, false).length) q.set('with_companies', picked(f.companies, false).join('|'));
  if (picked(f.companies, true).length) q.set('without_companies', picked(f.companies, true).join(','));
  if (movie && picked(f.cast, false).length) q.set('with_cast', picked(f.cast, false).join(f.castMatch === 'all' ? ',' : '|'));
  if (movie && picked(f.crew, false).length) q.set('with_crew', picked(f.crew, false).join('|'));
  if (!movie && f.networks?.length) q.set('with_networks', f.networks.filter(Number.isInteger).join('|'));
  return `/discover/${type}?${q}`;
}
// every query a list runs: its kind's (movies and shows: both) for each date window
function queries(media: Media, f: Filters, mine: number[]) {
  const kinds: ['movie' | 'tv', boolean][] = media === 'movie' ? [['movie', false]] : media === 'tv' ? [['tv', false]] : media === 'anime' ? [['tv', true]]
    : media === 'animefilm' ? [['movie', true]]
    // movies and shows, unless it asks for cast or crew: TMDB's show search would ignore them and bring every show
    : f.cast?.length || f.crew?.length ? [['movie', false]] : [['movie', false], ['tv', false]];
  return kinds.flatMap(([type, anime]) => windows(f).map((w) => ({ type, anime, path: discoverPath(type, anime, f, w, mine) })));
}
// a library list's candidates: your rated and/or watched titles that fit, in the list's order (popular: what you did last first)
const library = (f: Filters) => !!(f.myFrom || f.myTo || f.watched || f.home?.length);
async function libraryPool(uid: string, media: Media, f: Filters) {
  const sets: Map<string, number>[] = [];   // key -> when you last rated or watched it
  const mine = new Map<string, number>();
  if (f.myFrom || f.myTo) {
    const m = new Map<string, number>();
    for (const r of await q.all<{ key: string; r: number; at: number }>('select key, max(rating) r, max(rated_at) at from ratings where user_id = ? and season < 0 group by key', uid))
      if (r.r >= (f.myFrom || 0) && r.r <= (f.myTo || 10)) { m.set(r.key, r.at); mine.set(r.key, r.r); }
    sets.push(m);
  }
  if (f.watched) {
    const y = new Date(new Date().getFullYear(), 0, 1).getTime(), ago = Date.now() - 365 * 24 * HOUR;
    const rows = f.watched === 'started'
      ? await q.all<{ key: string; at: number }>(`select h.key, max(h.watched_at) at from history h join titles t using (key) where h.user_id = ? and t.type != 'movie' and h.season > 0
          group by h.key, t.episodes having t.episodes > 0 and count(distinct h.season * 10000 + h.episode) < t.episodes`, uid)
      : await q.all<{ key: string; at: number }>(`select key, max(watched_at) at from history where user_id = ? group by key having max(watched_at) ${f.watched === 'year' ? '>=' : '<'} ?`, uid, f.watched === 'year' ? y : ago);
    sets.push(new Map(rows.map((r) => [r.key, r.at])));
  }
  if (f.home?.length) sets.push(await homeReleases(/^[A-Z]{2}$/.test(f.region || '') ? f.region! : 'US', f.home, f.homeWithin || 90, !!f.homeCinema,
    providersOf(f, f.my ? (await prefsOf(uid)).services : []), media === 'animefilm'));
  const at = sets.reduce((a, b) => new Map([...a].filter(([k]) => b.has(k))));
  const ts = await titlesOf([...at.keys()]), ws = windows(f), inc = f.genres || [], out = f.without || [];
  const fits = (t: Title) => {
    const kind = media === 'movie' ? t.type === 'movie' && !t.anime : media === 'tv' ? t.type === 'tv' && !t.anime : media === 'anime' ? (t.type === 'tv' && !!t.anime) || t.type === 'anime'
      : media === 'animefilm' ? t.type === 'movie' && !!t.anime : !t.anime;
    const g = genresOf(t), y = t.year;
    return kind && (!inc.length || (f.match === 'all' ? inc.every((x) => g.includes(x)) : inc.some((x) => g.includes(x)))) && !out.some((x) => g.includes(x))
      && ws.some((w) => !y || ((!w.gte || y >= Number(w.gte.slice(0, 4))) && (!w.lte || y <= Number(w.lte.slice(0, 4)))))
      && (!f.runtimeFrom || !t.runtime || t.runtime >= f.runtimeFrom) && (!f.runtimeTo || !t.runtime || t.runtime <= f.runtimeTo)
      && (!f.scoreFrom || (t.rating ?? 0) >= f.scoreFrom) && (!f.scoreTo || (t.rating ?? 10) <= f.scoreTo);
  };
  const list = [...at.keys()].map((k) => ts.get(k)).filter((t): t is Title => !!t && fits(t));
  const by: Record<string, (a: Title, b: Title) => number> = {
    rating: (a, b) => (mine.get(b.key) ?? b.rating ?? 0) - (mine.get(a.key) ?? a.rating ?? 0), newest: (a, b) => (b.year || 0) - (a.year || 0),
    oldest: (a, b) => (a.year || 9999) - (b.year || 9999), az: (a, b) => a.title.localeCompare(b.title), votes: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    releaseOld: (a, b) => at.get(a.key)! - at.get(b.key)! };
  if (f.sort === 'shuffle') for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  if (f.sort !== 'shuffle') list.sort(by[f.sort || ''] || ((a, b) => at.get(b.key)! - at.get(a.key)!));
  return list.map((t) => t.key);
}
// a smart list's candidates: each query's pages in turn, taken alternately (so movies and shows, or decades, mix), after leaving
// out what your library hides: as many as the list keeps, three times that for shuffle, five times (at most 600) when other
// sources' scores pick from them. Saved as titles
async function runSmart(uid: string, media: Media, f: Filters) {
  if (library(f)) { const pool = await libraryPool(uid, media, f); return { ...await pick(pool, f), total: pool.length, pool }; }
  const max = Math.min(500, Math.max(10, f.max || 60)), scored = floorsOf(f).length > 0;
  const want = scored ? Math.min(600, Math.max(max, max * 5)) : f.sort === 'shuffle' ? Math.min(600, Math.max(max, max * 3)) : max;
  const hide = new Set<string>();
  if (f.hideWatched) for (const r of await q.all<{ key: string }>('select distinct key from history where user_id = ?', uid)) hide.add(r.key);
  if (f.hidePlan) for (const r of await q.all<{ key: string }>('select key from watchlist where user_id = ?', uid)) hide.add(r.key);
  const rated = f.onlyRated ? new Set((await q.all<{ key: string }>('select distinct key from ratings where user_id = ?', uid)).map((r) => r.key)) : null;
  if (f.tvdbGenre && media === 'tv' && tvdbOn()) {
    const found = await tvdbCategory(f.tvdbGenre, { sort: f.sort, language: f.languages?.[0] || f.language, country: f.countries?.[0] || f.country, want: Math.min(600, want * 2) });
    const pool = found.filter((k) => !hide.has(k) && (!rated || rated.has(k))).slice(0, want);
    return { ...await pick(pool, f), total: found.length, pool };
  }
  const qs = queries(media, f, f.my ? (await prefsOf(uid)).services : []).map((x) => ({ ...x, keys: [] as string[], done: false }));
  const merged = () => { const out: string[] = [], seen = new Set<string>();
    for (let i = 0; qs.some((x) => i < x.keys.length); i++) for (const x of qs) { const k = x.keys[i]; if (k && !seen.has(k)) { seen.add(k); out.push(k); } }
    return out; };
  let total = 0;
  for (let page = 1; page <= 30 && qs.some((x) => !x.done) && merged().length < want; page++) {
    for (const x of qs.filter((y) => !y.done)) {
      const d = await tmdb<TmdbPage & { total_results?: number; total_pages?: number }>(`${x.path}&page=${page}`);
      if (page === 1) total += d.total_results || 0;
      // anime keeps only animation; movies and shows leave anime (Japanese animation) out, as Home's rows do
      const ts = await saveTitles(d.results.filter((r) => r.poster_path && (x.anime ? r.genre_ids?.includes(16) : !(r.original_language === 'ja' && r.genre_ids?.includes(16))))
        .map(fromTmdb(x.type)));
      for (const t of ts) if (!hide.has(t.key) && (!rated || rated.has(t.key))) x.keys.push(t.key);
      if (page >= Math.min(d.total_pages || 1, 500)) x.done = true;
    }
  }
  const pool = merged().slice(0, want);
  return { ...await pick(pool, f), total, pool };
}
// a list's titles from its candidates: those whose known scores pass (pending: not checked yet), shuffled for shuffle
async function pick(pool: string[], f: Filters) {
  let keys = pool, pending = 0;
  if (floorsOf(f).length) {
    const have = await known(pool), v = pool.map((k) => verdict(have.get(k), f));
    keys = pool.filter((_, i) => v[i] === 'pass'); pending = v.filter((x) => x === 'pending').length;
  }
  if (f.sort === 'shuffle') { keys = [...keys]; for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; } }
  return { keys: keys.slice(0, Math.min(500, Math.max(10, f.max || 60))), pending };
}

const newId = () => crypto.randomBytes(9).toString('base64url');
const listRow = (uid: string, id: string) => q.one<Row>('select * from lists where id = ? and user_id = ?', id, uid);
async function keysOf(l: Row) {
  if (l.kind === 'smart') return l.items || [];
  return (await q.all<{ key: string }>('select key from list_items where list_id = ? order by added_at desc', l.id)).map((r) => r.key);
}
// a list as its row: the first five posters (its stack), the count
async function cardOf(l: Row & { owner?: string }) {
  const keys = await keysOf(l), ts = await titlesOf(keys.slice(0, 5));
  return { id: l.id, name: l.name, description: l.description, kind: l.kind, media: l.media, filters: l.filters, shared: l.shared,
    owner: l.owner ?? null, count: keys.length, refreshedAt: l.refreshed_at, posters: keys.slice(0, 5).map((k) => ts.get(k)?.poster).filter(present) };
}
// others' lists shared on this Listick: those you follow, and the rest; each with its owner's name
const OTHERS = `select l.*, coalesce(nullif(u.name, ''), u.username) owner from lists l join "user" u on u.id = l.user_id where l.shared and l.user_id != ?`;
const othersOf = async (uid: string) => {
  const rows = await q.all<Row & { owner: string }>(`${OTHERS} order by l.created_at desc`, uid);
  const follows = new Set((await q.all<{ list_id: string }>('select list_id from list_follows where user_id = ?', uid)).map((r) => r.list_id));
  return { following: await Promise.all(rows.filter((l) => follows.has(l.id)).map(cardOf)), shared: await Promise.all(rows.filter((l) => !follows.has(l.id)).map(cardOf)) };
};
// a list you can open: yours, or someone's shared one
const visibleRow = (uid: string, id: string) => q.one<Row & { owner: string }>(`select l.*, coalesce(nullif(u.name, ''), u.username) owner from lists l join "user" u on u.id = l.user_id
  where l.id = ? and (l.user_id = ? or l.shared)`, id, uid);
export async function follow(uid: string, id: string, on: boolean) {
  const l = await visibleRow(uid, id);
  if (!l || l.user_id === uid) return { error: 'no such list' };
  if (on) await q.run('insert into list_follows (user_id, list_id, at) values (?, ?, ?) on conflict do nothing', uid, id, Date.now());
  else await q.run('delete from list_follows where user_id = ? and list_id = ?', uid, id);
  return { ok: true };
}
// a copy of a list you can open, yours to change: a smart one's settings (made again for you), a manual one's titles
export async function copyList(uid: string, id: string) {
  const l = await visibleRow(uid, id);
  if (!l) return { error: 'no such list' };
  const r = await createList(uid, { name: l.name, description: l.description, kind: l.kind, media: l.media, filters: l.filters });
  if ('error' in r || l.kind !== 'manual') return r;
  await q.run('insert into list_items (list_id, key, added_at) select ?, key, added_at from list_items where list_id = ? on conflict do nothing', r.id, id);
  return r;
}
// the page: your lists and the built-in ones
export async function listsOf(uid: string) {
  const rows = await q.all<Row>('select * from lists where user_id = ? order by position, created_at', uid);
  const posters = async (sql: string) => (await q.all<{ poster: string }>(sql, uid)).map((r) => r.poster);
  // split as Home's rows: anime films with movies, the rest with shows
  const plan = await q.one<{ n: number; movie: number; tv: number }>(`select count(*)::int n, count(*) filter (where t.type = 'movie')::int movie,
    count(*) filter (where t.type != 'movie')::int tv from watchlist w join titles t using (key) where w.user_id = ?`, uid);
  const watched = await q.one<{ n: number }>('select count(distinct key)::int n from history where user_id = ?', uid);
  const rated = await q.one<{ n: number; avg: number | null }>('select count(distinct key)::int n, round(avg(rating)::numeric, 1)::float avg from ratings where user_id = ? and season < 0', uid);
  return {
    lists: await Promise.all(rows.map((l) => cardOf(l))), ...await othersOf(uid),
    builtin: {
      plan: { ...plan, posters: await posters('select t.poster from watchlist w join titles t using (key) where w.user_id = ? and t.poster is not null order by w.added_at desc limit 5') },
      watched: { n: watched!.n, posters: await posters(`select t.poster from (select key, max(watched_at) at from history where user_id = ? group by key) h join titles t using (key)
        where t.poster is not null order by h.at desc limit 5`) },
      rated: { ...rated, posters: await posters(`select t.poster from (select key, max(rated_at) at from ratings where user_id = ? and season < 0 group by key) r join titles t using (key)
        where t.poster is not null order by r.at desc limit 5`) },
    },
    genres: GENRES,
  };
}
// one list with its titles as cards (a smart one never fetched yet is made now)
export async function listOf(uid: string, id: string) {
  const l = await visibleRow(uid, id);
  if (!l) return null;
  const mine = l.user_id === uid, made = l.kind === 'smart' && !l.refreshed_at ? await refreshList(l.user_id, id) : null;
  const row = made ? { ...made, owner: l.owner } : l, keys = await keysOf(row), wl = await watchKeys(uid);
  const following = !mine && !!(await q.one('select 1 from list_follows where user_id = ? and list_id = ?', uid, id));
  return { ...(await cardOf(row)), mine, following, items: await cardsOf(uid, keys, wl) };
}
// a built-in list as a page: Plan to watch (newest added first), Watched (last watched first), Rated (your highest first)
const BUILTIN = {
  plan: ['Plan to watch', 'select key from watchlist where user_id = ? order by added_at desc'],
  watched: ['Watched', 'select key from history where user_id = ? group by key order by max(watched_at) desc'],
  rated: ['Rated', 'select key from ratings where user_id = ? and season < 0 group by key order by max(rating) desc, max(rated_at) desc'],
} as const;
export const isBuiltin = (id: string): id is keyof typeof BUILTIN => id in BUILTIN;
export async function builtinOf(uid: string, id: keyof typeof BUILTIN) {
  const [name, sql] = BUILTIN[id], keys = (await q.all<{ key: string }>(sql, uid)).map((r) => r.key);
  return { id, name, kind: 'builtin', count: keys.length, items: await cardsOf(uid, keys, await watchKeys(uid)) };
}
const cleanName = (n: unknown) => (typeof n === 'string' ? n.trim().slice(0, 60) : '');
const cleanDesc = (d: unknown) => (typeof d === 'string' && d.trim() ? d.trim().slice(0, 200) : null);
const mediaOk = (m: unknown): m is Media => MEDIA.includes(m as Media);
export async function createList(uid: string, b: { name?: unknown; description?: unknown; kind?: unknown; media?: unknown; filters?: unknown; shared?: unknown; add?: unknown; row?: unknown }): Promise<{ id: string } | { error: string }> {
  const name = cleanName(b.name);
  if (!name) return { error: 'a name' };
  const smart = b.kind === 'smart';
  if (smart && !mediaOk(b.media)) return { error: 'a kind: movies, shows, anime or both' };
  const id = newId(), pos = (await q.one<{ n: number }>('select coalesce(max(position), 0) + 1 n from lists where user_id = ?', uid))!.n;
  await q.run(`insert into lists (id, user_id, name, description, kind, media, filters, shared, position, created_at) values (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)`,
    id, uid, name, cleanDesc(b.description), smart ? 'smart' : 'manual', smart ? b.media : null, smart ? JSON.stringify(b.filters || {}) : b.row ? JSON.stringify({ row: true }) : null, !!b.shared, pos, Date.now());
  if (smart) await refreshList(uid, id);
  if (!smart && typeof b.add === 'string') await setItem(uid, id, b.add, true);
  return { id };
}
export async function updateList(uid: string, id: string, b: { name?: unknown; description?: unknown; media?: unknown; filters?: unknown; shared?: unknown; row?: unknown }) {
  const l = await listRow(uid, id);
  if (!l) return { error: 'no such list' };
  const name = b.name !== undefined ? cleanName(b.name) : l.name;
  if (!name) return { error: 'a name' };
  const media = l.kind === 'smart' && mediaOk(b.media) ? b.media : l.media;
  let filters = (l.kind === 'smart' && b.filters ? b.filters : l.filters) as Filters | null;
  // row alone: on Home or not, for any list (a manual one's filters hold only that)
  if (b.row !== undefined) {
    const rest: Filters = { ...(filters || {}) }; delete rest.row;
    filters = b.row ? { ...rest, row: true } : Object.keys(rest).length || l.kind === 'smart' ? rest : null;
  }
  await q.run('update lists set name = ?, description = ?, media = ?, filters = ?::jsonb, shared = ? where id = ?', name, b.description !== undefined ? cleanDesc(b.description) : l.description,
    media, filters ? JSON.stringify(filters) : null, b.shared !== undefined ? !!b.shared : l.shared, id);
  // changed filters start the list over (otherwise a refresh keeps what it found)
  if (l.kind === 'smart' && (b.filters || b.media)) await refreshList(uid, id, true);
  return { ok: true };
}
export const deleteList = (uid: string, id: string) => q.run('delete from lists where id = ? and user_id = ?', id, uid);
// a refresh keeps what the list found: what it finds now first, then what it had, cut to its size (How many), so the oldest
// finds leave as new ones come; changed filters start it over
const sizeOf = (f: Filters) => Math.min(500, Math.max(10, f.max || 60));
const merged = (found: string[], had: string[] | null, f: Filters) => [...new Set([...found, ...(had || [])])].slice(0, sizeOf(f));
export async function refreshList(uid: string, id: string, over = false) {
  const l = await listRow(uid, id);
  if (!l || l.kind !== 'smart' || !l.media) return l;
  const { keys: found, pool } = await runSmart(uid, l.media, l.filters || {});
  if (floorsOf(l.filters || {}).length) await metaSet(`list-pool:${id}`, { at: Date.now(), keys: pool });
  const keys = over ? found : merged(found, l.items, l.filters || {});
  await q.run('update lists set items = ?::jsonb, refreshed_at = ? where id = ?', JSON.stringify(keys), Date.now(), id);
  return listRow(uid, id);
}
// the scores job: a list picked again from its candidates as their scores come in
export async function reselect(id: string) {
  const l = await q.one<Row>('select * from lists where id = ?', id), pool = (await metaGet<{ keys: string[] }>(`list-pool:${id}`))?.keys;
  if (!l || !pool) return;
  const { keys: found } = await pick(pool, l.filters || {});
  const keys = merged(found, l.items, l.filters || {});
  await q.run('update lists set items = ?::jsonb where id = ?', JSON.stringify(keys), id);
}
// a title in or out of a manual list
export async function setItem(uid: string, id: string, key: string, on: boolean) {
  const l = await listRow(uid, id);
  if (!l || l.kind !== 'manual') return { error: 'no such list' };
  if (!(await titlesOf([key])).has(key)) return { error: 'unknown title' };
  if (on) await q.run('insert into list_items (list_id, key, added_at) values (?, ?, ?) on conflict do nothing', id, key, Date.now());
  else await q.run('delete from list_items where list_id = ? and key = ?', id, key);
  return { ok: true };
}
// Add to list: your manual lists, and whether each holds the title
export async function membership(uid: string, key: string) {
  const rows = await q.all<Row>("select * from lists where user_id = ? and kind = 'manual' order by position, created_at", uid);
  const has = new Set((await q.all<{ list_id: string }>('select list_id from list_items where key = ? and list_id = any(?)', key, rows.map((r) => r.id))).map((r) => r.list_id));
  return { lists: await Promise.all(rows.map(async (l) => ({ id: l.id, name: l.name, count: (await keysOf(l)).length, on: has.has(l.id) }))) };
}
// the builder's preview: how many match and all the titles the list keeps, to scroll through
export async function preview(uid: string, media: Media, f: Filters) {
  const { keys, total, pending, pool } = await runSmart(uid, media, f);
  if (pending) warm(pool, f);
  const ts = await titlesOf(keys);
  return { total, count: keys.length, pending, pool: pool.length, posters: keys.map((k) => ts.get(k)).filter(present).map((t) => ({ key: t.key, title: t.title, poster: t.poster })) };
}
// the worker: smart lists due by their refresh (daily, weekly), a few at a time
export async function refreshDue() {
  const rows = await q.all<Row>(`select * from lists where kind = 'smart' and coalesce(filters->>'refresh', 'daily') != 'never'
    and (refreshed_at is null or refreshed_at < case when filters->>'refresh' = 'weekly' then ?::bigint else ?::bigint end) order by refreshed_at nulls first limit 20`,
    Date.now() - 7 * 24 * HOUR, Date.now() - 24 * HOUR);
  for (const l of rows) await refreshList(l.user_id, l.id).catch((e) => console.error(`list ${l.id}: ${e}`));
  if (rows.length) console.log(`lists: ${rows.length} smart lists refreshed`);
}
// the builder's searches: TMDB keywords, people (cast, crew) and studios by name
export async function pickSearch(kind: string, text: string) {
  if (!['keyword', 'person', 'company'].includes(kind) || text.trim().length < 2) return [];
  type R = { id: number; name: string; known_for_department?: string; profile_path?: string | null; logo_path?: string | null; origin_country?: string };
  const r = await tmdb<{ results: R[] }>(`/search/${kind}?query=${encodeURIComponent(text.trim())}&include_adult=false`);
  return r.results.slice(0, 10).map((x) => ({ id: x.id, name: x.name, sub: x.known_for_department || x.origin_country || null,
    image: x.profile_path || x.logo_path ? `https://image.tmdb.org/t/p/w92${x.profile_path || x.logo_path}` : null }));
}
// your lists shown as rows (Home, and a smart one's kind's page too): each one's first 20 titles as cards
export async function rowLists(uid: string) {
  const rows = await q.all<Row>("select * from lists where user_id = ? and (filters->>'row')::boolean order by position, created_at", uid);
  const wl = await watchKeys(uid);
  return Promise.all(rows.map(async (l) => { const keys = await keysOf(l); return { id: l.id, name: l.name, media: l.media, total: keys.length, items: await cardsOf(uid, keys.slice(0, 20), wl) }; }));
}
// the catalogs addon: every list of yours (which ones show in Stremio is chosen on the addon's page), and one's titles
export const stremioLists = (uid: string) => q.all<{ id: string; name: string }>('select id, name from lists where user_id = ? order by position, created_at', uid);
export async function listKeys(uid: string, id: string) { const l = await listRow(uid, id); return l ? keysOf(l) : null; }
// apps (Seanime): your lists, then the ones you follow, with their titles
export async function appLists(uid: string) {
  const own = await q.all<Row & { owner?: string }>('select * from lists where user_id = ? order by position, created_at', uid);
  const followed = await q.all<Row & { owner: string }>(`${OTHERS} and l.id in (select list_id from list_follows where user_id = ?) order by l.created_at desc`, uid, uid);
  return Promise.all([...own, ...followed].map(async (l) => ({ id: l.id, name: l.name, owner: l.owner ?? null, keys: await keysOf(l) })));
}
export const builtinKeys = async (uid: string, id: 'watched' | 'rated') =>
  ({ name: BUILTIN[id][0], keys: (await q.all<{ key: string }>(BUILTIN[id][1], uid)).map((r) => r.key) });
