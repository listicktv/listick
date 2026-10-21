// For the Stremio addon: a title as a Stremio meta (TMDB details, episodes from the TVDB or Kitsu) and Stremio's search.
import { details, season } from './details';
import { fribb, loadFribb } from './mapping';
import { TMDB_IMG, fetchCounted, getJSON, kitsu, tmdb } from './sources';
import type { KitsuList, KitsuOne, TmdbFind, TmdbImages, TmdbPage, TvdbEpisode } from './types';
import { HOUR, env, msg } from './util';

// TVDB v4: a token from the API key (valid a month; renewed after 20 days or on a 401), then the English episode list in its
// default order, a page of 500 at a time
let tvdbAuth: { token: string | null; at: number } = { token: null, at: 0 };
async function tvdb<T>(path: string, again = true): Promise<T> {
  if (!env('TVDB_API_KEY')) throw new Error('no TVDB key');
  if (!tvdbAuth.token || Date.now() - tvdbAuth.at > 20 * 24 * HOUR) {
    const r = await fetchCounted('https://api4.thetvdb.com/v4/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apikey: env('TVDB_API_KEY') }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`tvdb login -> ${r.status}`);
    tvdbAuth = { token: (await r.json()).data?.token, at: Date.now() };
  }
  try { return await getJSON<T>(`https://api4.thetvdb.com/v4${path}`, { Authorization: `Bearer ${tvdbAuth.token}` }); }
  catch (e) { if (again && / -> 401$/.test(msg(e))) { tvdbAuth.token = null; return tvdb<T>(path, false); } throw e; }
}
// TVDB gives most images as a path on its artworks host ("/banners/v4/episode/…jpg"): a full URL for Stremio
const tvdbImg = (x: string | null | undefined) => (x ? (/^https?:/.test(x) ? x : `https://artworks.thetvdb.com${x.startsWith('/') ? '' : '/'}${x}`) : undefined);
const tvdbEpCache = new Map<number, { at: number; eps: TvdbEpisode[] }>();
async function tvdbEpisodes(id: number) {
  const c = tvdbEpCache.get(id);
  if (c && Date.now() - c.at < 12 * HOUR) return c.eps;
  const eps: TvdbEpisode[] = [];
  for (let page = 0; page < 20; page++) {
    const d = await tvdb<{ data?: { episodes?: TvdbEpisode[] }; links?: { next?: string | null } }>(`/series/${id}/episodes/default/eng?page=${page}`);
    eps.push(...(d.data?.episodes || []));
    if (!d.links?.next) break;
  }
  tvdbEpCache.set(id, { at: Date.now(), eps });
  return eps;
}
// a title's logo (English or text-free) for Stremio's detail page
async function tmdbLogo(type: string, id: string) {
  const d = await tmdb<TmdbImages>(`/${type}/${id}/images?include_image_language=en,null`).catch(() => null);
  const l = (d?.logos || []).sort((a, b) => Number(b.iso_639_1 === 'en') - Number(a.iso_639_1 === 'en') || (b.vote_average || 0) - (a.vote_average || 0))[0];
  return l ? `${TMDB_IMG}w500${l.file_path}` : undefined;
}
// a Stremio id (tt…, tmdb:<n>) and type to a Listick key; IMDb ids through TMDB's find, kept a day
const findCache = new Map<string, { at: number; key: string | null }>();
async function keyOfStremio(type: string, id: string) {
  const kind = type === 'movie' ? 'movie' : 'tv';
  let m = String(id).match(/^tmdb:(\d+)$/);
  if (m) return `tmdb:${kind}:${m[1]}`;
  m = String(id).match(/^kitsu:(\d+)$/);
  if (m) return `kitsu:anime:${m[1]}`;
  m = String(id).match(/^(tt\d+)$/);
  if (!m) return null;
  const c = findCache.get(m[1]);
  if (c && Date.now() - c.at < 24 * HOUR) return c.key;
  const d = await tmdb<TmdbFind>(`/find/${m[1]}?external_source=imdb_id`);
  const hit = (kind === 'movie' ? d.movie_results : d.tv_results)?.[0];
  const key = hit ? `tmdb:${kind}:${hit.id}` : null;
  findCache.set(m[1], { at: Date.now(), key });
  return key;
}
const hhmm = (min: number | null | undefined) => (min ? (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`) : undefined);
const ytId = (u: string | null | undefined) => String(u || '').match(/[?&]v=([\w-]{11})/)?.[1];
// a show asked for by its IMDb id: its TVDB entry by that id (TVDB follows IMDb's seasons; TMDB sometimes splits an
// anthology into one show per season, so its IMDb match can be a stray entry: Monster tt13207736), kept a day
const tvdbByImdbCache = new Map<string, { at: number; id: number | null }>();
async function tvdbByImdb(imdb: string) {
  const c = tvdbByImdbCache.get(imdb);
  if (c && Date.now() - c.at < 24 * HOUR) return c.id;
  const id = (await tvdb<{ data?: { series?: { id: number } }[] }>(`/search/remoteid/${imdb}`).catch(() => null))?.data?.find((x) => x.series)?.series?.id || null;
  tvdbByImdbCache.set(imdb, { at: Date.now(), id });
  return id;
}
// a title as Stremio's addon protocol has it (a meta, its videos)
type StremioVideo = { id: string; title: string; season: number; episode: number; released?: string; overview?: string; thumbnail?: string };
type StremioMeta = { id: string; type: string; name: string; videos?: StremioVideo[]; [field: string]: unknown };
// a show built from TVDB alone (when TMDB has no match, or a different show): its name, poster, overview, genres, years
// and its episodes, each <IMDb id>:<season>:<episode>
async function tvdbMeta(id: string, imdb: string, tvdbId: number): Promise<StremioMeta | null> {
  type Series = { name: string; image?: string; overview?: string; firstAired?: string; lastAired?: string; status?: { name?: string }; genres?: { name: string }[]; averageRuntime?: number };
  const d = (await tvdb<{ data?: Series }>(`/series/${tvdbId}/extended?short=true`))?.data;
  if (!d) return null;
  const iso = (x: string | null | undefined) => (x ? new Date(x).toISOString() : undefined);
  const y0 = (d.firstAired || '').slice(0, 4), y1 = (d.lastAired || '').slice(0, 4), ended = /ended/i.test(d.status?.name || '');
  const eps = await tvdbEpisodes(tvdbId).catch((): TvdbEpisode[] => []);
  return {
    id, type: 'series', name: d.name, poster: tvdbImg(d.image), posterShape: 'poster', description: d.overview || undefined,
    releaseInfo: y0 ? (ended && y1 && y1 !== y0 ? `${y0}–${y1}` : ended ? y0 : `${y0}–`) : undefined, released: iso(d.firstAired),
    genres: (d.genres || []).map((g) => g.name), runtime: hhmm(d.averageRuntime),
    links: [{ name: 'IMDb', category: 'imdb', url: `https://www.imdb.com/title/${imdb}/` }], behaviorHints: {},
    videos: eps.filter((e) => Number.isInteger(e.seasonNumber) && Number.isInteger(e.number)).map((e) => ({ id: `${imdb}:${e.seasonNumber}:${e.number}`,
      title: e.name || `Episode ${e.number}`, season: e.seasonNumber, episode: e.number, released: iso(e.aired), overview: e.overview || undefined, thumbnail: tvdbImg(e.image) || tvdbImg(d.image) })),
  };
}
type CardDetail = Awaited<ReturnType<typeof details>>;
const metaCache = new Map<string, { at: number; meta: StremioMeta }>();
export async function stremioMeta(type: string, id: string): Promise<StremioMeta | null> {
  // a show by IMDb id whose TMDB match isn't TVDB's show for that id: TVDB's
  if (type === 'series' && /^tt\d+$/.test(id)) {
    const tv = await tvdbByImdb(id).catch(() => null);
    if (tv) {
      const k = await keyOfStremio(type, id), dd = k ? await details(k).catch(() => null) : null;
      if (!dd || Number(dd.tvdb) !== Number(tv)) {
        const mc = metaCache.get(`tvdb|${tv}`);
        if (mc && Date.now() - mc.at < 6 * HOUR) return { ...mc.meta, id };
        const meta = await tvdbMeta(id, id, tv);
        if (meta) { metaCache.set(`tvdb|${tv}`, { at: Date.now(), meta }); return meta; }
      }
    }
  }
  const key = await keyOfStremio(type, id);
  if (!key) return null;
  const mc = metaCache.get(`${type}|${key}`);
  if (mc && Date.now() - mc.at < 6 * HOUR) return { ...mc.meta, id };   // the same title asked for by another id keeps that id
  const d = await details(key), tid = key.split(':')[2], kind = key.split(':')[1];
  if (kind === 'anime') return kitsuMeta(type, id, key, tid, d);
  const imdb = /^tt\d+$/.test(d.imdb || '') ? d.imdb : null;
  // an anime film plays as its Kitsu entry when Fribb knows one
  if (d.anime) await loadFribb();
  const kitsuFilm = d.anime && kind === 'movie' ? fribb.byMovie.get(Number(tid)) ?? null : null;
  const trailer = ytId(d.trailer);
  const lastAired = typeof d.facts?.lastAired === 'string' ? d.facts.lastAired : null;
  const meta: StremioMeta = {
    // the id Stremio asked for stays its id; the IMDb id is what streams are asked for (defaultVideoId, the episodes' ids)
    id, type, name: d.title, poster: d.poster || undefined, posterShape: 'poster', background: d.backdrop || undefined,
    logo: await tmdbLogo(kind, tid), description: [d.tagline, d.overview].filter(Boolean).join(' ') || undefined,
    releaseInfo: d.year ? (kind === 'tv' && lastAired && d.status && !/return|production|planned/i.test(d.status) && Number(lastAired.slice(0, 4)) !== d.year
      ? `${d.year}–${lastAired.slice(0, 4)}` : kind === 'tv' && /return/i.test(d.status || '') ? `${d.year}–` : String(d.year)) : undefined,
    released: d.released ? new Date(d.released).toISOString() : undefined, runtime: hhmm(d.runtime),
    genres: d.genres?.length ? d.genres : undefined, cast: (d.cast || []).map((c) => c.name).slice(0, 10),
    director: kind === 'movie' ? d.people?.names : undefined, writer: d.writers?.length ? d.writers : undefined,
    imdbRating: d.scores?.imdb || undefined, country: d.facts?.country || undefined, language: d.facts?.language || undefined,
    trailers: trailer ? [{ source: trailer, type: 'Trailer' }] : undefined, trailerStreams: trailer ? [{ ytId: trailer, title: d.title }] : undefined,
    links: imdb ? [{ name: 'IMDb', category: 'imdb', url: `https://www.imdb.com/title/${imdb}/` }] : undefined,
    behaviorHints: kind === 'movie' ? { defaultVideoId: kitsuFilm ? `kitsu:${kitsuFilm}` : imdb || `tmdb:${tid}` } : {},
  };
  if (kind === 'tv') meta.videos = d.anime ? await animeEpisodes(d, key, tid, imdb) : await stremioEpisodes(d, key, tid, imdb);
  metaCache.set(`${type}|${key}`, { at: Date.now(), meta });
  return meta;
}
// a show's episodes: TVDB's default order when the show has a TVDB id (TMDB's stills where TVDB has no image), else TMDB's
// seasons; each one's id is <IMDb id>:<season>:<episode>, what stream addons look up
async function stremioEpisodes(d: CardDetail, key: string, tid: string, imdb: string | null): Promise<StremioVideo[]> {
  const vid = (se: number, ep: number) => `${imdb || `tmdb:${tid}`}:${se}:${ep}`;
  const iso = (x: string | null | undefined) => (x ? new Date(x).toISOString() : undefined);
  if (d.tvdb) {
    try {
      const eps = (await tvdbEpisodes(d.tvdb)).filter((e) => Number.isInteger(e.seasonNumber) && Number.isInteger(e.number));
      if (eps.length) {
        // an episode without a TVDB image: TMDB's still of the same season and episode, else (not out yet, mostly) the
        // show's background, so none is blank
        const stills = new Map<string, string>();
        for (const sn of new Set(eps.filter((e) => !e.image).map((e) => e.seasonNumber)))
          for (const x of await season(key, sn, null).catch(() => [])) if (x.still) stills.set(`${sn}:${x.ep}`, x.still);
        return eps.map((e) => ({ id: vid(e.seasonNumber, e.number), title: e.name || `Episode ${e.number}`, season: e.seasonNumber, episode: e.number,
          released: iso(e.aired), overview: e.overview || undefined, thumbnail: tvdbImg(e.image) || stills.get(`${e.seasonNumber}:${e.number}`) || d.backdrop || undefined }));
      }
    } catch (e) { console.error(`tvdb ${d.tvdb}: ${msg(e)}`); }
  }
  const out: StremioVideo[] = [];
  for (const sn of (d.seasons || []).map((x) => x.n)) {
    for (const e of await season(key, sn, null).catch(() => [])) out.push({ id: vid(sn, e.ep), title: e.name || `Episode ${e.ep}`, season: sn, episode: e.ep,
      released: iso(e.air), overview: e.overview || undefined, thumbnail: e.still || d.backdrop || undefined });
  }
  return out;
}
// an anime show Listick keeps as its TMDB show: TMDB's seasons (Fribb's places are TMDB's), each episode asked for as the
// Kitsu entry that covers it (entries by TMDB season and episode offset; a season-less entry counts across the seasons),
// else as <IMDb id>:<season>:<episode>
// how many episodes a Kitsu entry has (null while it's still airing with no count): an entry covers only its own episodes
const kitsuCounts = new Map<number, { at: number; n: number | null }>();
async function kitsuCount(id: number) {
  const c = kitsuCounts.get(id);
  if (c && Date.now() - c.at < 24 * HOUR) return c.n;
  const n = (await kitsu<KitsuOne>(`/anime/${id}?fields[anime]=episodeCount`).catch(() => null))?.data?.attributes?.episodeCount ?? null;
  kitsuCounts.set(id, { at: Date.now(), n });
  return n;
}
async function animeEpisodes(d: CardDetail, key: string, tid: string, imdb: string | null): Promise<StremioVideo[]> {
  await loadFribb();
  const entries = await Promise.all((fribb.byTmdb.get(Number(tid)) || []).map(async (e) => ({ ...e, count: await kitsuCount(e.kitsu) })));
  const whole = entries.find((e) => e.season == null);
  const iso = (x: string | null | undefined) => (x ? new Date(x).toISOString() : undefined);
  const out: StremioVideo[] = [];
  let abs = 0;
  for (const sn of (d.seasons || []).map((x) => x.n)) {
    for (const e of await season(key, sn, null).catch(() => [])) {
      if (sn > 0) abs++;
      const cover = entries.filter((x) => x.season === sn && x.offset < e.ep && (x.count == null || e.ep - x.offset <= x.count)).sort((a, b) => b.offset - a.offset)[0];
      const vid = cover ? `kitsu:${cover.kitsu}:${e.ep - cover.offset}` : whole && sn > 0 ? `kitsu:${whole.kitsu}:${abs}` : `${imdb || `tmdb:${tid}`}:${sn}:${e.ep}`;
      out.push({ id: vid, title: e.name || `Episode ${e.ep}`, season: sn, episode: e.ep, released: iso(e.air), overview: e.overview || undefined, thumbnail: e.still || d.backdrop || undefined });
    }
  }
  return out;
}
// an anime Listick keeps as its Kitsu entry: Kitsu's details (MAL's score), its episodes kitsu:<id>:<n> in one season
async function kitsuMeta(type: string, id: string, key: string, tid: string, d: CardDetail) {
  const film = d.format === 'movie' || type === 'movie', trailer = ytId(d.trailer);
  const iso = (x: string | null | undefined) => (x ? new Date(x).toISOString() : undefined);
  const meta: StremioMeta = {
    id, type, name: d.title, poster: d.poster || undefined, posterShape: 'poster', background: d.backdrop || undefined,
    description: d.overview || undefined, releaseInfo: d.year ? String(d.year) : undefined, released: iso(d.released), runtime: hhmm(d.runtime),
    genres: d.genres?.length ? d.genres : undefined, cast: (d.cast || []).map((c) => c.name).slice(0, 10),
    imdbRating: d.rating && d.ratingSrc === 'mal' ? Number(d.rating).toFixed(1) : undefined, country: 'JP', language: 'JA',
    trailers: trailer ? [{ source: trailer, type: 'Trailer' }] : undefined, trailerStreams: trailer ? [{ ytId: trailer, title: d.title }] : undefined,
    links: d.malUrl ? [{ name: 'MyAnimeList', category: 'MyAnimeList', url: d.malUrl }] : undefined,
    behaviorHints: film ? { defaultVideoId: `kitsu:${tid}` } : {},
  };
  if (!film) meta.videos = (await season(key, 1, null).catch(() => [])).map((e) => ({ id: `kitsu:${tid}:${e.ep}`, title: e.name || `Episode ${e.ep}`,
    season: 1, episode: e.ep, released: iso(e.air), overview: e.overview || undefined, thumbnail: e.still || d.backdrop || undefined }));
  metaCache.set(`${type}|${key}`, { at: Date.now(), meta });
  return meta;
}
// Stremio's search: TMDB's matches, as tmdb:<id> items (their details open through stremioMeta)
export async function stremioSearch(type: string, text: string) {
  if (type === 'anime.series' || type === 'anime.movie') {
    const d = await kitsu<KitsuList>(`/anime?filter[text]=${encodeURIComponent(text)}&filter[subtype]=${type === 'anime.movie' ? 'movie' : 'TV,ONA,OVA'}&page[limit]=20`);
    return (d.data || []).filter((x) => x.attributes.posterImage).map((x) => ({ id: `kitsu:${x.id}`, type: type === 'anime.movie' ? 'movie' : 'series',
      name: x.attributes.titles?.en || x.attributes.canonicalTitle, poster: x.attributes.posterImage!.medium || x.attributes.posterImage!.original,
      releaseInfo: (x.attributes.startDate || '').slice(0, 4) || undefined }));
  }
  const kind = type === 'movie' ? 'movie' : 'tv';
  const d = await tmdb<TmdbPage>(`/search/${kind}?query=${encodeURIComponent(text)}&include_adult=false`);
  return (d.results || []).filter((r) => r.poster_path).slice(0, 30).map((r) => ({ id: `tmdb:${r.id}`, type, name: r.title || r.name,
    poster: `${TMDB_IMG}w342${r.poster_path}`, releaseInfo: (r.release_date || r.first_air_date || '').slice(0, 4) || undefined, description: r.overview || undefined }));
}
