// A title's card (the panel): TMDB's or Kitsu's details, kept 6 h in detail_cache, with the user's activity; seasons and their episodes.
import { cardsOf, nextUp } from './cards';
import { q } from './db';
import { fribb, fromMal, loadFribb } from './mapping';
import { langOf, namesOf, posterAt } from './names';
import { TMDB_IMG, getJSON, kitsu, mal, tmdb } from './sources';
import { watchKeys } from './store';
import { cleanSynopsis, fillFromTmdb, fromKitsu, fromTmdb, getTitle, saveTitles } from './titles';
import { fillFromTvdb, tvdbSplit, tvdbSplitKnown } from './tvdb';
import { watchingOf } from './watching';
import type { Detail, Episode, KitsuList, KitsuOne, MalAnime, Omdb, Title, TmdbCollection, TmdbDetails, TmdbSeasonDetails, Uid } from './types';
import { HOUR, env } from './util';

const REGION = 'FI';

// ---------- title details (the panel), kept 6 h in detail_cache (shared with the worker, which warms them) ----------
type Play = { season: number; episode: number; watched_at: number; approx: number; source: string };
async function activity(key: string, uid: Uid) {
  const plays = await q.all<Play>('select season, episode, watched_at, approx, source from history where user_id = ? and key = ? order by watched_at', uid, key);
  const eps = new Map<string, Play>();
  for (const p of plays) if (p.season !== -1) eps.set(`${p.season}:${p.episode}`, p);
  const bySeason: Record<number, number> = {};
  for (const p of eps.values()) bySeason[p.season] = (bySeason[p.season] || 0) + 1;
  const dated = plays.filter((p) => p.approx !== 1);
  return {
    plays: plays.length, episodes: eps.size, bySeason,
    first: dated[0]?.watched_at || null, last: dated.at(-1)?.watched_at || null,
    movieDates: plays.filter((p) => p.season === -1).map((p) => (p.approx === 1 ? null : p.watched_at)).reverse().slice(0, 12),
    // a movie's plays, newest first, with their stored time (a date-unknown one sits on the release date): to change one's date
    moviePlays: plays.filter((p) => p.season === -1).map((p) => ({ at: p.watched_at, approx: p.approx, source: p.source })).reverse().slice(0, 12),
    rating: (await q.one<{ rating: number }>('select rating from ratings where user_id = ? and key = ? and season = -1 and episode = -1', uid, key))?.rating || null,
    // a show's seasons: your rating of each, and the average of your episode ratings in it
    seasonRatings: Object.fromEntries((await q.all<{ season: number; rating: number }>('select season, rating from ratings where user_id = ? and key = ? and season >= 0 and episode = -1', uid, key)).map((r) => [r.season, r.rating])),
    seasonAvg: Object.fromEntries((await q.all<{ season: number; a: number }>('select season, round(avg(rating)::numeric, 1) a from ratings where user_id = ? and key = ? and season >= 0 and episode >= 0 group by season', uid, key)).map((r) => [r.season, r.a])),
  };
}
// an anime's card is made again once when its parts change (ANIME_V), not left for the 6 h
const ANIME_V = 2;
const isAnime = (v: Detail) => v.anime || v.type === 'anime';
async function cachedDetail(key: string) {
  const c = await q.one<{ at: number; value: Detail }>('select at, value from detail_cache where key = ?', key);
  return c && Date.now() - c.at < 6 * HOUR && (!isAnime(c.value) || c.value.v === ANIME_V) ? c.value : null;
}
// uid: whose plays, ratings and Plan to watch the card carries (none: a title looked up for no one)
export async function details(key: string, uid: Uid = null) {
  let value = await cachedDetail(key);
  if (!value) {
    const [src, type, id] = key.split(':');
    value = src === 'tmdb' ? await tmdbDetails(type as 'movie' | 'tv', id) : await kitsuDetails(id);
    if (isAnime(value)) value.v = ANIME_V;
    await q.run(`insert into detail_cache (key, at, value) values (?, ?, ?::jsonb) on conflict (key) do update set at = excluded.at, value = excluded.value`,
      key, Date.now(), JSON.stringify(value));
  }
  const wl = await watchKeys(uid), n = (await namesOf([key], await langOf(uid))).get(key);
  // in uid's language where that's known: its name, poster and story
  if (n) value = { ...value, title: n.title || value.title, poster: posterAt(n.poster, 'w780') || value.poster, overview: n.overview || value.overview };
  // similar leaves out the collection's own films (they have their row)
  const similarKeys = (value.similarKeys || []).filter((k) => k !== key && !(value.collectionKeys || []).includes(k));
  // a show TheTVDB splits differently: its seasons too, with how many of each you've watched
  const [src, kind, id] = key.split(':');
  // anime waits for it; other shows get it on a later open
  let split = null;
  if (src === 'tmdb' && kind === 'tv') {
    if (isAnime(value)) split = await tvdbSplit(id).catch(() => null);
    else { const known = tvdbSplitKnown(id); if (known === undefined) void tvdbSplit(id, true).catch(() => null); else split = known; }
  }
  const you = await activity(key, uid);
  if (split && uid) {
    const seen = new Set((await q.all<{ season: number; episode: number }>('select distinct season, episode from history where user_id = ? and key = ? and season > 0', uid, key)).map((r) => `${r.season}:${r.episode}`));
    Object.assign(you, { bySeasonTvdb: Object.fromEntries(split.map((s) => [s.n, s.eps.filter((e) => seen.has(`${e.se}:${e.tep}`)).length])) });
  }
  return { ...value, seasonsTvdb: split ? split.map((s) => ({ n: s.n, name: `Season ${s.n}`, episodes: s.eps.length, year: s.year })) : null,
    watchlist: wl.has(key), you, upNext: await nextUp({ key, type: value.type, anime: value.anime }, uid),
    watching: uid ? (await watchingOf(uid)).find((w) => w.key === key) ?? null : null,
    collectionItems: await cardsOf(uid, value.collectionKeys || [], wl), similar: await cardsOf(uid, similarKeys, wl) };
}
// one season's episodes (TMDB for shows; Kitsu's list for anime) with your plays of each
const seasonCache = new Map<string, { at: number; value: Episode[] }>();
// a season as TheTVDB numbers it: each episode TMDB's, at its TMDB place (se, tep), with your plays and rating there
async function tvdbSeasonOf(key: string, n: number, uid: Uid): Promise<Episode[]> {
  const split = (await tvdbSplit(key.split(':')[2]).catch(() => null))?.find((s) => s.n === n);
  if (!split) return [];
  const base = new Map<number, Map<number, Episode>>();
  for (const se of new Set(split.eps.map((e) => e.se))) base.set(se, new Map((await season(key, se, null)).map((e) => [e.ep, e])));
  const plays = uid ? await q.all<{ season: number; episode: number; at: number; n: number; approx: number; source: string }>(`select season, episode, max(watched_at) at, count(*) n,
    max(approx) approx, (array_agg(source order by watched_at desc))[1] source from history where user_id = ? and key = ? and season > 0 group by season, episode`, uid, key) : [];
  const rated = uid ? await q.all<{ season: number; episode: number; rating: number }>('select season, episode, rating from ratings where user_id = ? and key = ? and season > 0 and episode >= 0', uid, key) : [];
  const play = new Map(plays.map((r) => [`${r.season}:${r.episode}`, r])), mine = new Map(rated.map((r) => [`${r.season}:${r.episode}`, r.rating]));
  return split.eps.flatMap((x) => {
    const e = base.get(x.se)?.get(x.tep);
    if (!e) return [];
    const p = play.get(`${x.se}:${x.tep}`);
    return [{ ...e, ep: x.ep, se: x.se, tep: x.tep, watched: p ? { at: p.at, plays: p.n, approx: p.approx, source: p.source } : null, mine: mine.get(`${x.se}:${x.tep}`) ?? null }];
  });
}
export async function season(key: string, n: number, uid: Uid, tvdbOrder = false): Promise<Episode[]> {
  if (tvdbOrder) return tvdbSeasonOf(key, n, uid);
  const ck = `${key}|${n}`;
  let c = seasonCache.get(ck);
  if (!c || Date.now() - c.at > 6 * HOUR) {
    const [src, , id] = key.split(':');
    let eps: Episode[] = [];
    if (src === 'tmdb') {
      const d = await tmdb<TmdbSeasonDetails>(`/tv/${id}/season/${n}`);
      eps = (d.episodes || []).map((e) => ({ ep: e.episode_number, name: e.name || null, air: e.air_date || null, runtime: e.runtime || null,
        still: e.still_path ? `${TMDB_IMG}w300${e.still_path}` : null, overview: e.overview || null }));
      eps = await fillFromTvdb(id, n, eps).catch(() => eps);
    } else {
      const page = (off: number) => kitsu<KitsuList>(`/anime/${id}/episodes?sort=number&page[limit]=20&page[offset]=${off}`);
      const first = await page(0), count = Math.min(first.meta?.count || 0, 3000), rest: number[] = [];
      for (let off = 20; off < count; off += 20) rest.push(off);
      const pages = [first];
      for (let i = 0; i < rest.length; i += 10) pages.push(...await Promise.all(rest.slice(i, i + 10).map(page)));   // ten at a time
      for (const d of pages) eps.push(...(d.data || []).map((x) => { const a = x.attributes; return { ep: a.number!, name: a.titles?.en_us || a.titles?.en || a.canonicalTitle || null,
        air: a.airdate || null, runtime: a.length || null, still: a.thumbnail?.original || null, overview: cleanSynopsis(a.synopsis) }; }));
    }
    c = { at: Date.now(), value: eps.filter((e) => e.ep != null) };
    seasonCache.set(ck, c);
  }
  if (!uid) return c.value.map((e) => ({ ...e, watched: null, mine: null }));
  // the latest play's source per episode
  const seen = await q.all<{ episode: number; at: number; n: number; approx: number; source: string }>(`select episode, max(watched_at) at, count(*) n, max(approx) approx, (array_agg(source order by watched_at desc))[1] source
    from history where user_id = ? and key = ? and season = ? group by episode`, uid, key, n);
  const by = Object.fromEntries(seen.map((r) => [r.episode, r]));
  const mine: Record<number, number> = Object.fromEntries((await q.all<{ episode: number; rating: number }>('select episode, rating from ratings where user_id = ? and key = ? and season = ? and episode >= 0', uid, key, n)).map((r) => [r.episode, r.rating]));
  return c.value.map((e) => ({ ...e, watched: by[e.ep] ? { at: by[e.ep].at, plays: by[e.ep].n, approx: by[e.ep].approx, source: by[e.ep].source } : null, mine: mine[e.ep] ?? null }));
}
async function tmdbDetails(type: 'movie' | 'tv', id: string): Promise<Detail> {
  const extra = type === 'movie' ? ',release_dates,videos,recommendations' : ',content_ratings,videos,recommendations';
  const d = await tmdb<TmdbDetails>(`/${type}/${id}?append_to_response=credits,watch/providers,external_ids${extra}`);
  const [t] = await saveTitles([fromTmdb(type)(d)]);
  const fi = d['watch/providers']?.results?.[REGION] || {};
  const prov = (list: { provider_name: string; logo_path?: string | null }[] | undefined) => (list || []).map((p) => ({ name: p.provider_name, logo: p.logo_path ? `${TMDB_IMG}w92${p.logo_path}` : null }));
  const crew = (job: string) => (d.credits?.crew || []).filter((c) => c.job === job).map((c) => c.name);
  return {
    // the card shows the poster ~240 px wide (480 px on a sharp screen): the 780 px image, not the rows' 342 px one
    ...pick(t), poster: d.poster_path ? `${TMDB_IMG}w780${d.poster_path}` : t.poster, backdrop: d.backdrop_path ? `${TMDB_IMG}w1280${d.backdrop_path}` : t.backdrop,
    genres: (d.genres || []).map((g) => g.name), runtime: d.runtime || d.episode_run_time?.[0] || null,
    released: d.release_date || d.first_air_date || null, status: d.status || null, tagline: d.tagline || null,
    // specials (season 0) last
    seasons: type === 'tv' ? (d.seasons || []).filter((s) => s.episode_count > 0).sort((a, b) => (a.season_number || 999) - (b.season_number || 999))
      .map((s) => ({ n: s.season_number, name: s.season_number ? s.name || '' : 'Specials', episodes: s.episode_count, year: Number((s.air_date || '').slice(0, 4)) || null })) : null,
    next: d.next_episode_to_air ? { season: d.next_episode_to_air.season_number, ep: d.next_episode_to_air.episode_number, date: d.next_episode_to_air.air_date ?? null } : null,
    people: type === 'movie' ? { label: 'Director', names: crew('Director') } : { label: 'Created by', names: (d.created_by || []).map((c) => c.name) },
    cast: (d.credits?.cast || []).slice(0, 10).map((c) => ({ name: c.name, role: c.character || null, photo: c.profile_path ? `${TMDB_IMG}w185${c.profile_path}` : null })),
    providers: { stream: prov(fi.flatrate), free: prov([...(fi.free || []), ...(fi.ads || [])]), rent: prov(fi.rent), buy: prov(fi.buy) },
    imdb: d.external_ids?.imdb_id || d.imdb_id || null, tvdb: d.external_ids?.tvdb_id || null,
    scores: await omdbFor(d.external_ids?.imdb_id || d.imdb_id),
    collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name } : null,
    ...(type === 'movie' ? await movieExtras(d) : await tvExtras(d)),
    anime: !!t.anime, ...(t.anime ? (type === 'tv' ? await animeExtras(id) : await animeFilmExtras(id)) : {}),
    facts: {
      network: (d.networks || []).map((n) => n.name).slice(0, 3).join(', ') || null,
      studio: (d.production_companies || []).map((n) => n.name).slice(0, 2).join(', ') || null,
      country: (d.origin_country || (d.production_countries || []).map((c) => c.iso_3166_1)).slice(0, 2).join(', ') || null,
      language: d.original_language ? d.original_language.toUpperCase() : null,
      lastAired: d.last_air_date || null, episodes: d.number_of_episodes || null,
    },
  };
}
// Rotten Tomatoes and Metacritic pages from Wikidata by IMDb id (OMDb gives their scores, not their pages); null on a failed
// lookup, so it is tried again on the next view
async function reviewPages(imdb: string) {
  if (!/^tt\d+$/.test(imdb)) return null;
  const sparql = `SELECT ?rt ?mc WHERE { ?f wdt:P345 "${imdb}" . OPTIONAL { ?f wdt:P1258 ?rt } OPTIONAL { ?f wdt:P1712 ?mc } } LIMIT 1`;
  type Sparql = { results?: { bindings?: { rt?: { value: string }; mc?: { value: string } }[] } };
  const d = await getJSON<Sparql>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
    { accept: 'application/sparql-results+json' }).catch(() => null);
  if (!d) return null;
  const b = d.results?.bindings?.[0] || {};
  return { rt: b.rt ? `https://www.rottentomatoes.com/${b.rt.value}` : null, mc: b.mc ? `https://www.metacritic.com/${b.mc.value}/` : null };
}
export async function omdbFor(imdb: string | null | undefined): Promise<Omdb | null> {
  if (!env('OMDB_API_KEY') || !imdb) return null;
  const row = await q.one<{ data: Omdb; fetched_at: number }>('select data, fetched_at from omdb where imdb = ?', imdb);
  if (row && Date.now() - row.fetched_at < 7 * 86400000) {
    const c = row.data;
    // scores cached before the pages were looked up get them on their next view
    if (c.pages === undefined && (c.rt || c.mc)) {
      const pages = await reviewPages(imdb);
      if (pages) { c.pages = pages; await q.run('update omdb set data = ?::jsonb where imdb = ?', JSON.stringify(c), imdb); }
    }
    return c;
  }
  type OmdbAnswer = { Response?: string; imdbRating?: string; imdbVotes?: string; Awards?: string; Rated?: string; Ratings?: { Source: string; Value: string }[] };
  const d = await getJSON<OmdbAnswer>(`https://www.omdbapi.com/?i=${imdb}&apikey=${env('OMDB_API_KEY')}`).catch(() => null);
  if (!d || d.Response === 'False') return row ? row.data : null;
  const score = (src: string) => d.Ratings?.find((r) => r.Source === src)?.Value || null;
  const num = (v: string | undefined) => (v && v !== 'N/A' ? v : null);
  const out: Omdb = { imdb: num(d.imdbRating), votes: num(d.imdbVotes), rt: score('Rotten Tomatoes'), mc: score('Metacritic')?.replace('/100', '') || null,
    awards: num(d.Awards), rated: num(d.Rated) };
  if (out.rt || out.mc) { const pages = await reviewPages(imdb); if (pages) out.pages = pages; }
  await q.run('insert into omdb (imdb, data, fetched_at) values (?, ?::jsonb, ?) on conflict (imdb) do update set data = excluded.data, fetched_at = excluded.fetched_at',
    imdb, JSON.stringify(out), Date.now());
  return out;
}
const trailerOf = (d: TmdbDetails) => {
  const yt = (d.videos?.results || []).filter((v) => v.site === 'YouTube' && v.type === 'Trailer').sort((a, b) => (Number(b.official) - Number(a.official)) || (a.iso_639_1 === 'en' ? -1 : 1))[0];
  return yt ? `https://www.youtube.com/watch?v=${yt.key}` : null;
};
// the show card's: its age rating (US, else UK), trailer and TMDB's recommended shows
async function tvExtras(d: TmdbDetails) {
  const cert = (reg: string) => (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === reg)?.rating || null;
  const similarKeys = (await saveTitles((d.recommendations?.results || []).filter((x) => x.poster_path && (x.media_type || 'tv') === 'tv').slice(0, 20).map(fromTmdb('tv')))).map((t) => t.key);
  return { certification: cert('US') || cert('GB'), trailer: trailerOf(d), similarKeys };
}
// an anime show's card also gets its first season's Kitsu score, and MyAnimeList's score and rank (of its first season's
// entry, via Fribb) and MAL's recommendations as Similar, which fit anime better than TMDB's
const kitsuScore = (a: { averageRating?: string | null; slug?: string } | undefined) =>
  (a?.averageRating ? { score: Math.round(Number(a.averageRating)) / 10, url: `https://kitsu.app/anime/${a.slug}` } : null);
// an anime film's Kitsu score: its Kitsu entry through Fribb
async function animeFilmExtras(id: string): Promise<Partial<Pick<Detail, 'kitsu'>>> {
  await loadFribb();
  const k = fribb.byMovie.get(Number(id));
  const score = k ? kitsuScore((await kitsu<KitsuOne>(`/anime/${k}`).catch(() => null))?.data.attributes) : null;
  return score ? { kitsu: score } : {};
}
async function animeExtras(id: string): Promise<Partial<Pick<Detail, 'mal' | 'kitsu' | 'similarKeys'>>> {
  await loadFribb();
  const entries = (fribb.byTmdb.get(Number(id)) || []).sort((a, b) => (a.season || 99) - (b.season || 99) || a.offset - b.offset);
  const k = entries[0] ? kitsuScore((await kitsu<KitsuOne>(`/anime/${entries[0].kitsu}`).catch(() => null))?.data.attributes) : null;
  const kit = k ? { kitsu: k } : {};
  const first = entries.filter((e) => e.mal)[0];
  if (!first || !env('MAL_CLIENT_ID')) return kit;
  const m = await mal<MalAnime>(`/anime/${first.mal}?fields=mean,rank,recommendations`).catch(() => null);
  if (!m) return kit;
  const similarKeys = m.recommendations?.length ? (await saveTitles(await fromMal(m.recommendations.slice(0, 12)))).map((x) => x.key).filter((k) => k !== `tmdb:tv:${id}`) : [];
  return { ...kit, mal: { score: m.mean || null, rank: m.rank || null, url: `https://myanimelist.net/anime/${first.mal}` }, ...(similarKeys.length ? { similarKeys } : {}) };
}
// the movie card's extras; titles shown as cards are saved so their keys work (watched / watchlist state is added fresh)
async function movieExtras(d: TmdbDetails) {
  const cert = (reg: string) => (d.release_dates?.results || []).find((r) => r.iso_3166_1 === reg)?.release_dates?.map((x) => x.certification).find(Boolean) || null;
  const us = cert('US'), gb = cert('GB');
  let collectionKeys: string[] = [];
  if (d.belongs_to_collection) {
    const c = await tmdb<TmdbCollection>(`/collection/${d.belongs_to_collection.id}`).catch(() => null);
    const parts = (c?.parts || []).filter((x) => x.poster_path).sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'));
    collectionKeys = (await saveTitles(parts.map(fromTmdb('movie')))).map((t) => t.key);
  }
  const similarKeys = (await saveTitles((d.recommendations?.results || []).filter((x) => x.poster_path && (x.media_type || 'movie') === 'movie').slice(0, 20).map(fromTmdb('movie')))).map((t) => t.key);
  const crew = (jobs: string[]) => [...new Set((d.credits?.crew || []).filter((c) => jobs.includes(c.job)).map((c) => c.name))];
  return {
    certification: us || gb || null,   // the US rating (PG-13, R…), else the UK one
    trailer: trailerOf(d),
    writers: crew(['Screenplay', 'Writer', 'Story']).slice(0, 4),
    money: { budget: d.budget || null, revenue: d.revenue || null },
    collectionKeys, similarKeys,
  };
}
// an anime's card: Kitsu's entry (genres, other sites' ids, studios) and characters at once, then MyAnimeList's score, rank, age
// rating, studios, source and recommendations (Similar), so it has what a show's card has
const MAL_RATING: Record<string, string> = { g: 'G', pg: 'PG', pg_13: 'PG-13', r: 'R-17+', 'r+': 'R+', rx: 'Rx' };
async function kitsuDetails(id: string): Promise<Detail> {
  const [d, ch] = await Promise.all([
    kitsu<KitsuOne>(`/anime/${id}?include=categories,mappings,animeProductions.producer`),
    kitsu<KitsuList>(`/anime/${id}/characters?include=character&page[limit]=20`).catch(() => null),
  ]);
  const [t] = await saveTitles(await fillFromTmdb([fromKitsu(d.data)]));
  const a = d.data.attributes, stored = await getTitle(t.key), inc = d.included || [];
  const malId = inc.find((x) => x.type === 'mappings' && x.attributes.externalSite === 'myanimelist/anime')?.attributes.externalId;
  const m = malId && env('MAL_CLIENT_ID') ? await mal<MalAnime>(`/anime/${malId}?fields=mean,rank,rating,source,studios,recommendations`).catch(() => null) : null;
  const similarKeys = m?.recommendations?.length ? (await saveTitles(await fromMal(m.recommendations.slice(0, 12)))).map((x) => x.key) : [];
  // studios: MyAnimeList's, else Kitsu's productions with the studio role
  const producer = (pid: string | undefined) => inc.find((x) => x.type === 'producers' && x.id === pid)?.attributes.name;
  const studios = m?.studios?.map((x) => x.name) || inc.filter((x) => x.type === 'animeProductions' && x.attributes.role === 'studio').map((x) => producer(x.relationships?.producer?.data?.id)).filter(Boolean);
  // characters: main ones first
  const who = (cid: string | undefined) => (ch?.included || []).find((x) => x.type === 'characters' && x.id === cid)?.attributes;
  const cast = (ch?.data || []).map((x) => ({ role: x.attributes.role, c: who(x.relationships?.character?.data?.id) })).filter((x) => x.c)
    .sort((p, r) => (p.role === 'main' ? 0 : 1) - (r.role === 'main' ? 0 : 1))
    .slice(0, 12).map((x) => ({ name: x.c!.canonicalName || x.c!.names?.en, role: x.role === 'main' ? 'Main' : 'Supporting', photo: x.c!.image?.original || null }));
  const mean = m?.mean || (stored?.rating_src === 'mal' ? stored.rating : null);
  return {
    ...pick({ ...t, poster: a.posterImage?.large || a.posterImage?.original || t.poster || stored?.poster || null, ...(mean ? { rating: mean, rating_src: 'mal' } : {}) }),
    ratingSrc: mean ? 'mal' : t.rating_src, backdrop: a.coverImage?.original || t.backdrop, overview: cleanSynopsis(a.synopsis),
    genres: inc.filter((x) => x.type === 'categories').map((g) => g.attributes.title!).slice(0, 6),
    runtime: a.episodeLength || null, released: a.startDate || null, status: a.status || null, tagline: null,
    episodes: a.episodeCount || null, format: a.subtype || null,
    seasons: a.subtype === 'movie' ? null : [{ n: 1, name: 'Episodes', episodes: a.episodeCount || null, year: Number((a.startDate || '').slice(0, 4)) || null }],
    facts: { studio: studios.slice(0, 2).join(', ') || null, country: 'JP', language: 'JA', lastAired: a.endDate || null, episodes: a.episodeCount || null,
      season: a.startDate ? `${['Winter', 'Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall'][Number(a.startDate.slice(5, 7)) - 1]} ${a.startDate.slice(0, 4)}` : null,
      source: m?.source ? m.source.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null, rank: m?.rank || null },
    next: a.nextRelease ? { date: a.nextRelease.slice(0, 10) } : null,
    certification: (m?.rating && MAL_RATING[m.rating]) || null, trailer: a.youtubeVideoId ? `https://www.youtube.com/watch?v=${a.youtubeVideoId}` : null,
    people: null, cast, providers: null, imdb: null, malUrl: malId ? `https://myanimelist.net/anime/${malId}` : null, similarKeys, kitsu: kitsuScore(a) || undefined,
  };
}
const pick = (t: Title) => ({ key: t.key, type: t.type, title: t.title, label: t.label, year: t.year, poster: t.poster, backdrop: t.backdrop,
  rating: t.rating, ratingSrc: t.rating_src || null, overview: t.overview, url: t.url });
