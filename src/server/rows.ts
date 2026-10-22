// The shared rows (trending, popular, in theaters, kids, anime) and the streaming services' rows: built by the worker, kept in
// meta 'rows'; and every row's title cards warmed in the background.
import { q } from './db';
import { details } from './details';
import { asTmdb, fribb, fromMal, loadFribb } from './mapping';
import { kitsu, mal, tmdb } from './sources';
import { metaGet, metaSet } from './store';
import { fillFromTmdb, fromKitsu, fromTmdb, prune, saveTitles, titlesOf, tmdbGenres } from './titles';
import type { KitsuList, MalList, Title, TmdbDetails, TmdbItem, TmdbPage, TmdbReleaseDates, TmdbWatchProviders } from './types';
import { HOUR, env, msg } from './util';

   // where you are: the title card's watch providers
const ROW_REGION = 'US';
// Kitsu's own "trending" is all-time favourites; a season's anime, most followed first, is what is actually hot
const SEASONS = ['winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall'];
async function kitsuSeason(ahead = 0) {
  const d0 = new Date(), d = new Date(d0.getFullYear(), d0.getMonth() + 3 * ahead, 1);
  return kitsuList(`/anime?filter[season]=${SEASONS[d.getMonth()]}&filter[seasonYear]=${d.getFullYear()}&sort=-userCount&page[limit]=20`);
}
const kitsuList = async (path: string) => asTmdb(await fillFromTmdb((await kitsu<KitsuList>(path)).data.map(fromKitsu)));
const tmdbList = async (type: 'movie' | 'tv', path: string, keep: (x: TmdbItem) => boolean = () => true) => (await tmdb<TmdbPage>(path)).results.filter(keep).map(fromTmdb(type));
// the catalogs (catalogs/) filter rows by genre, so each row is kept DEEP long; the page shows its first `page` titles
const DEEP = 100;
// the first `pages` pages of a TMDB list (20 a page), in order, without repeats
async function tmdbPages(type: 'movie' | 'tv', path: string, pages = 5, keep: (x: TmdbItem) => boolean = () => true) {
  const all = await Promise.all(Array.from({ length: pages }, (_, i) => tmdb<TmdbPage>(`${path}${path.includes('?') ? '&' : '?'}page=${i + 1}`).then((d) => d.results, () => [] as TmdbItem[])));
  const seen = new Set<number>();
  return all.flat().filter((x) => keep(x) && !seen.has(x.id) && seen.add(x.id)).map(fromTmdb(type));
}
// shows on the big streaming services (TMDB provider ids): the US ones, plus the main UK ones (BBC, ITV, Channel 4, Sky)
type Region = 'US' | 'GB';
const STREAMING: Record<Region, number[]> = {
  US: [8, 9, 350, 337, 15, 1899, 386, 387, 2303, 2616],   // Netflix, Prime Video, Apple TV+, Disney+, Hulu, HBO Max, Peacock, Paramount+
  GB: [38, 41, 103, 333, 137, 39, 29, 531],                // BBC iPlayer, ITVX, Channel 4, 5, UKTV Play (U), NOW, Sky Go, Paramount+
};
const NO_TALK = 'without_genres=10767,10763,10762';   // talk shows, news and kids' shows
// anime stays out of the movie and show rows: Japanese animation, and (shows, whose results say where they're made) animation
// from Japan, China or Korea, which TMDB can list in English (Cyberpunk: Edgerunners) or Chinese (donghua: Fights Break Sphere)
const ANIME_LANDS = ['JP', 'CN', 'KR'];
const notAnime = (x: TmdbItem) => !(x.genre_ids?.includes(16) && (x.original_language === 'ja' || !!x.origin_country?.some((c) => ANIME_LANDS.includes(c))));
// popular: the most popular subscription shows on those services that premiered in the last 4 years (otherwise decades of
// Law & Order and NCIS fill the row), about three US picks to one UK pick
async function popularStreamingShows() {
  const since = new Date(Date.now() - 4 * 365 * 86400000).toISOString().slice(0, 10);
  const qs = (reg: Region) => `/discover/tv?watch_region=${reg}&with_watch_providers=${STREAMING[reg].join('|')}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&vote_count.gte=50&first_air_date.gte=${since}&${NO_TALK}`;
  const [us, gb] = await Promise.all([tmdbPages('tv', qs('US'), 5, notAnime), tmdbPages('tv', qs('GB'), 5, notAnime)]);
  const out: Title[] = [], seen = new Set<string>();
  for (let i = 0, u = 0, g = 0; out.length < DEEP && (u < us.length || g < gb.length); i++) {
    const t = (i % 4 === 3 ? gb[g++] : us[u++]) || gb[g++] || us[u++];
    if (t && !seen.has(t.key)) { seen.add(t.key); out.push(t); }
  }
  return out;
}
// trending: this week's trending shows that stream on one of those services
async function trendingStreamingShows() {
  const pages = await Promise.all(Array.from({ length: 12 }, (_, i) => tmdb<TmdbPage>(`/trending/tv/week?page=${i + 1}`).then((d) => d.results, () => [] as TmdbItem[])));
  const out: Title[] = [];
  for (const x of pages.flat().filter((x) => notAnime(x) && !x.genre_ids?.some((g) => [10767, 10763, 10762].includes(g)))) {
    if (out.length >= DEEP) break;
    const w = await tmdb<TmdbWatchProviders>(`/tv/${x.id}/watch/providers`).catch(() => null);
    const on = (reg: Region) => (w?.results?.[reg]?.flatrate || []).some((p) => STREAMING[reg].includes(p.provider_id) || STREAMING.US.includes(p.provider_id));
    if (on('US') || on('GB')) out.push(fromTmdb('tv')(x));
  }
  return out;
}

// kids: the same rules with TMDB's Kids genre (10762) for shows (left out of the rows above) and Family (10751) rated PG or
// lower for movies. Trending kids shows: this week's trending kids shows on those services, topped up when few trend with
// kids shows on them that aired an episode in the last 60 days; popular: the most popular ones that premiered in the last 8
// years (kids shows run long, Bluey started 2018), three US picks to one UK pick
const KIDS_TV = 10762, FAMILY = 10751;
const KIDS_MOVIE = `with_genres=${FAMILY}&certification_country=US&certification.lte=PG`;
async function popularKidsShows() {
  const since = new Date(Date.now() - 8 * 365 * 86400000).toISOString().slice(0, 10);
  const qs = (reg: Region) => `/discover/tv?watch_region=${reg}&with_watch_providers=${STREAMING[reg].join('|')}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&vote_count.gte=20&first_air_date.gte=${since}&with_genres=${KIDS_TV}`;
  const [us, gb] = await Promise.all([tmdbPages('tv', qs('US'), 5, notAnime), tmdbPages('tv', qs('GB'), 5, notAnime)]);
  const out: Title[] = [], seen = new Set<string>();
  for (let i = 0, u = 0, g = 0; out.length < DEEP && (u < us.length || g < gb.length); i++) {
    const t = (i % 4 === 3 ? gb[g++] : us[u++]) || gb[g++] || us[u++];
    if (t && !seen.has(t.key)) { seen.add(t.key); out.push(t); }
  }
  return out;
}
async function trendingKidsShows() {
  const pages = await Promise.all(Array.from({ length: 15 }, (_, i) => tmdb<TmdbPage>(`/trending/tv/week?page=${i + 1}`).then((d) => d.results, () => [] as TmdbItem[])));
  const out: Title[] = [];
  for (const x of pages.flat().filter((x) => notAnime(x) && x.genre_ids?.includes(KIDS_TV))) {
    if (out.length >= DEEP) break;
    const w = await tmdb<TmdbWatchProviders>(`/tv/${x.id}/watch/providers`).catch(() => null);
    const on = (reg: Region) => (w?.results?.[reg]?.flatrate || []).some((p) => STREAMING[reg].includes(p.provider_id) || STREAMING.US.includes(p.provider_id));
    if (on('US') || on('GB')) out.push(fromTmdb('tv')(x));
  }
  // topped up (after the page's 20) with kids shows on those services that aired an episode in the last 60 days
  if (out.length < DEEP) {
    const recent = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const more = await tmdbPages('tv', `/discover/tv?watch_region=US&with_watch_providers=${STREAMING.US.join('|')}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&air_date.gte=${recent}&with_genres=${KIDS_TV}`, 4, notAnime).catch(() => []);
    for (const t of more) if (out.length < DEEP && !out.some((o) => o.key === t.key)) out.push(t);
  }
  return out;
}
// kids movies: this week's trending Family films rated PG or lower (TMDB's trending list has no filter, so the first pages
// are checked against the rating), topped up when few trend with the most popular of those released in the last 4 months;
// and the most popular ones in the region
async function trendingKidsMovies() {
  const pages = await Promise.all(Array.from({ length: 15 }, (_, i) => tmdb<TmdbPage>(`/trending/movie/week?page=${i + 1}`).then((d) => d.results, () => [] as TmdbItem[])));
  const seen = new Set<number>(), family = pages.flat().filter((x) => x.genre_ids?.includes(FAMILY) && !seen.has(x.id) && seen.add(x.id));
  const out: Title[] = [];
  for (const x of family) {
    if (out.length >= DEEP) break;
    const r = await tmdb<{ results?: TmdbReleaseDates[] }>(`/movie/${x.id}/release_dates`).catch(() => null);
    const us = (r?.results || []).find((c) => c.iso_3166_1 === 'US')?.release_dates.map((d) => d.certification).filter(Boolean) || [];
    if (us.some((c) => ['G', 'PG'].includes(c))) out.push(fromTmdb('movie')(x));
  }
  if (out.length < DEEP) {
    const recent = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const more = await tmdbPages('movie', `/discover/movie?region=${ROW_REGION}&${KIDS_MOVIE}&sort_by=popularity.desc&primary_release_date.gte=${recent}`, 4).catch(() => []);
    for (const t of more) if (out.length < DEEP && !out.some((o) => o.key === t.key)) out.push(t);
  }
  return out;
}
const popularKidsMovies = () => tmdbPages('movie', `/discover/movie?region=${ROW_REGION}&${KIDS_MOVIE}&sort_by=popularity.desc&vote_count.gte=100`);
const MAL_FIELDS = 'fields=alternative_titles,main_picture,mean,start_season,genres';
async function trendingAnime() {
  if (!env('MAL_CLIENT_ID')) return kitsuSeason(0);
  const d = new Date(), year = d.getFullYear(), season = SEASONS[d.getMonth()];
  // only what started within the last year (multi-cour shows included): shows on all year round (One Piece, Detective Conan) would top it
  const idx = (y: number, se: string) => y * 4 + ['winter', 'spring', 'summer', 'fall'].indexOf(se), now = idx(year, season);
  const list = (await mal<MalList>(`/anime/season/${year}/${season}?sort=anime_num_list_users&limit=300&${MAL_FIELDS}`)).data
    .filter(({ node: n }) => n.start_season && now - idx(n.start_season.year, n.start_season.season) <= 3);
  return fromMal(list.slice(0, DEEP));
}
// anime films: MAL lists films with the series, so these filter on media_type. Trending: films that started in the last four
// seasons and are out (not announced ones), by how many people list them; popular: MAL's all-time popularity ranking, films only
async function trendingAnimeMovies() {
  if (!env('MAL_CLIENT_ID')) return kitsuList(`/anime?filter[subtype]=movie&filter[seasonYear]=${new Date().getFullYear() - 1}..${new Date().getFullYear()}&sort=popularityRank&page[limit]=20`);
  const order = ['winter', 'spring', 'summer', 'fall'], d = new Date();
  let y = d.getFullYear(), i = order.indexOf(SEASONS[d.getMonth()]);
  const seasons: [number, string][] = [], today = d.toISOString().slice(0, 10);
  for (let n = 0; n < 4; n++) { seasons.push([y, order[i]]); if (--i < 0) { i = 3; y--; } }
  const lists = await Promise.all(seasons.map(([yy, se]) => mal<MalList>(`/anime/season/${yy}/${se}?sort=anime_num_list_users&limit=100&${MAL_FIELDS},media_type,num_list_users,start_date`).then((r) => r.data).catch((e) => { console.error(`mal ${yy} ${se}: ${msg(e)}`); return []; })));
  const seen = new Set<number>();
  const films = lists.flat().filter(({ node: n }) => n.media_type === 'movie' && n.start_date && n.start_date <= today && !seen.has(n.id) && seen.add(n.id))
    .sort((a, b) => (b.node.num_list_users || 0) - (a.node.num_list_users || 0));
  return fromMal(films.slice(0, DEEP));
}
// kids anime: MAL's All ages (g) and Children (pg) ratings. Trending: started in the last four seasons, by how many people list
// it; popular: MAL's all-time popularity ranking, those ratings only
const KIDS_RATED = ['g', 'pg'];
async function trendingKidsAnime() {
  if (!env('MAL_CLIENT_ID')) return kitsuList(`/anime?filter[ageRating]=G,PG&filter[seasonYear]=${new Date().getFullYear() - 1}..${new Date().getFullYear()}&sort=popularityRank&page[limit]=20`);
  const order = ['winter', 'spring', 'summer', 'fall'], d = new Date();
  let y = d.getFullYear(), i = order.indexOf(SEASONS[d.getMonth()]);
  const seasons: [number, string][] = [];
  for (let n = 0; n < 4; n++) { seasons.push([y, order[i]]); if (--i < 0) { i = 3; y--; } }
  const lists = await Promise.all(seasons.map(([yy, se]) => mal<MalList>(`/anime/season/${yy}/${se}?sort=anime_num_list_users&limit=300&${MAL_FIELDS},rating,num_list_users`).then((r) => r.data).catch((e) => { console.error(`mal ${yy} ${se}: ${msg(e)}`); return []; })));
  const seen = new Set<number>();
  const kids = lists.flat().filter(({ node: n }) => KIDS_RATED.includes(n.rating!) && !seen.has(n.id) && seen.add(n.id))
    .sort((a, b) => (b.node.num_list_users || 0) - (a.node.num_list_users || 0));
  return fromMal(kids.slice(0, DEEP));
}
async function popularKidsAnime() {
  if (!env('MAL_CLIENT_ID')) return kitsuList('/anime?filter[ageRating]=G,PG&sort=popularityRank&page[limit]=20');
  // few of the most popular are rated for kids: the top 2,000 (four pages)
  const pages = await Promise.all([0, 500, 1000, 1500].map((off) => mal<MalList>(`/anime/ranking?ranking_type=bypopularity&limit=500&offset=${off}&${MAL_FIELDS},rating`).then((r) => r.data).catch((e) => { console.error(`mal popularity ${off}: ${msg(e)}`); return []; })));
  return fromMal(pages.flat().filter(({ node: n }) => KIDS_RATED.includes(n.rating!)).slice(0, DEEP));
}
async function popularAnimeMovies() {
  if (!env('MAL_CLIENT_ID')) return kitsuList('/anime?filter[subtype]=movie&sort=popularityRank&page[limit]=20');
  const list = (await mal<MalList>(`/anime/ranking?ranking_type=bypopularity&limit=500&${MAL_FIELDS},media_type`)).data;
  return fromMal(list.filter(({ node: n }) => n.media_type === 'movie').slice(0, DEEP));
}
async function popularAnime() {
  if (!env('MAL_CLIENT_ID')) return kitsuList('/anime?sort=popularityRank&page[limit]=20');
  return fromMal((await mal<MalList>(`/anime/ranking?ranking_type=bypopularity&limit=${DEEP}&${MAL_FIELDS}`)).data);
}

// coming soon: this region's upcoming films not out yet, soonest first
async function comingMovies() {
  const today = new Date().toISOString().slice(0, 10), when = new Map<string, string>();
  const list = await tmdbPages('movie', `/movie/upcoming?region=${ROW_REGION}`, 5, (x) => { const ok = !!x.release_date && x.release_date > today && !!x.poster_path; if (ok) when.set(`tmdb:movie:${x.id}`, x.release_date!); return ok; });
  return list.sort((a, b) => (when.get(a.key) || '').localeCompare(when.get(b.key) || ''));
}
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ON_STREAMING = `watch_region=US&with_watch_providers=${STREAMING.US.join('|')}&with_watch_monetization_types=flatrate`;
// box office: this region's cinema releases of the last ~10 weeks by what they've taken (TMDB's revenue), highest first; 20+
// votes, as small films' revenue is often missing or stray
const boxOffice = () => tmdbPages('movie', `/discover/movie?region=${ROW_REGION}&with_release_type=3&primary_release_date.gte=${day(-75)}&primary_release_date.lte=${day(0)}&sort_by=revenue.desc&vote_count.gte=20`, 2);
// new on streaming: films whose digital release here was in the last 45 days, most popular first
const newOnStreaming = () => tmdbPages('movie', `/discover/movie?region=${ROW_REGION}&with_release_type=4&release_date.gte=${day(-45)}&release_date.lte=${day(0)}&sort_by=popularity.desc&vote_count.gte=10`, 3, notAnime);
// new shows: first aired in the last 60 days, on the streaming services, most popular first
const hasPoster = (x: TmdbItem) => !!x.poster_path;
const newShows = () => tmdbPages('tv', `/discover/tv?first_air_date.gte=${day(-60)}&first_air_date.lte=${day(0)}&${ON_STREAMING}&sort_by=popularity.desc&${NO_TALK}`, 3, (x) => notAnime(x) && hasPoster(x));
// premiering soon: English-language shows starting in the next 60 days (not on a service yet), most anticipated first; only
// those with a poster (many announced shows have none yet)
const premieres = () => tmdbPages('tv', `/discover/tv?first_air_date.gte=${day(1)}&first_air_date.lte=${day(60)}&with_original_language=en&sort_by=popularity.desc&${NO_TALK}`, 3, (x) => notAnime(x) && hasPoster(x));
// anime airing this week: Japanese animation with an episode in the next 7 days, most popular first; not TMDB's Kids genre
// (Doraemon and the like air every week for decades)
const animeThisWeek = () => tmdbPages('tv', `/discover/tv?with_genres=16&with_original_language=ja&air_date.gte=${day(0)}&air_date.lte=${day(7)}&sort_by=popularity.desc&without_genres=10762`, 3);
// top rated anime: MyAnimeList's score ranking when MAL_CLIENT_ID is set, else Kitsu's
async function topRatedAnime() {
  if (!env('MAL_CLIENT_ID')) return kitsuList('/anime?sort=ratingRank&page[limit]=20');
  return fromMal((await mal<MalList>(`/anime/ranking?ranking_type=all&limit=${DEEP}&${MAL_FIELDS}`)).data);
}
// what the episode rows leave out: talk, news, kids', reality (WWE Raw is TMDB reality) and soaps (a new episode every day)
const NOT_WEEKLY = 'without_genres=10767,10763,10762,10764,10766';
// returning shows: shows on air for a year or more whose new season started in the last 3 weeks or starts in the next 30 days
// (TMDB can't search by season premiere, so each candidate's last and next episode tell), most popular first
async function returningShows() {
  const since = 21, filters = `with_original_language=en&${ON_STREAMING}&${NOT_WEEKLY}`, keep = notAnime;
  const cands = await tmdbPages('tv', `/discover/tv?air_date.gte=${day(-since)}&air_date.lte=${day(30)}&first_air_date.lte=${day(-365)}&sort_by=popularity.desc&${filters}`, 3, keep);
  const out: Title[] = [];
  for (const t of cands) {
    const d = await tmdb<TmdbDetails>(`/tv/${t.key.split(':')[2]}`).catch(() => null);
    const last = d?.last_episode_to_air, next = d?.next_episode_to_air;
    const premiere = (e: typeof last, from: number, to: number) => !!e && e.season_number > 1 && e.episode_number === 1 && !!e.air_date && e.air_date >= day(from) && e.air_date <= day(to);
    // the premiere itself: just aired (the latest episode is a new season's first) or coming (the next one is)
    if (premiere(next, 0, 30) || premiere(last, -since, 0)) out.push(t);
  }
  return out;
}
// returning anime: this season's TV anime that are a later season or part of a show (Fribb places them past its first season
// on TMDB, or in a later TheTVDB season), most followed first. TMDB numbers many anime's episodes straight on (The Apothecary
// Diaries S1 E51), so the shows' rule can't see their new seasons
async function returningAnime() {
  await loadFribb();
  const d = new Date(), season = SEASONS[d.getMonth()], year = d.getFullYear();
  const pages = await Promise.all([0, 20].map((o) => kitsu<KitsuList>(`/anime?filter[season]=${season}&filter[seasonYear]=${year}&filter[subtype]=TV&sort=-userCount&page[limit]=20&page[offset]=${o}`)
    .then((x) => x.data, () => [])));
  const later = pages.flat().filter((a) => {
    const m = fribb.map.get(Number(a.id)), t = m?.tmdb;
    return (t?.type === 'tv' && ((t.season ?? 0) > 1 || (t.offset ?? 0) > 0)) || (m?.season ?? 0) > 1;
  });
  return asTmdb(await fillFromTmdb(later.map(fromKitsu)));
}
// new episodes this week: English-language shows on the streaming services with an episode airing in the next 7 days, most
// popular first
async function newEpisodes() {
  const qs = `/discover/tv?air_date.gte=${day(0)}&air_date.lte=${day(7)}&with_original_language=en&${ON_STREAMING}&sort_by=popularity.desc&${NOT_WEEKLY}`;
  return tmdbPages('tv', qs, 5, notAnime);
}

type Row = { id: string; title: string; page: number; job: () => Promise<Title[]> };
export const ROWS: Row[] = [
  { id: 'theaters', title: 'In theaters', page: 20, job: () => tmdbPages('movie', `/movie/now_playing?region=${ROW_REGION}`) },
  // the Movies, TV and Anime pages' own rows, in their order there
  { id: 'movie-box-office', title: 'Box office', page: 20, job: boxOffice },
  { id: 'movie-streaming-new', title: 'New on streaming', page: 20, job: newOnStreaming },
  { id: 'movie-coming', title: 'Coming soon', page: 20, job: comingMovies },
  { id: 'tv-new-episodes', title: 'New episodes this week', page: 20, job: newEpisodes },
  { id: 'tv-returning', title: 'Returning shows', page: 20, job: returningShows },
  { id: 'tv-new-shows', title: 'New shows', page: 20, job: newShows },
  { id: 'tv-premieres', title: 'Premiering soon', page: 20, job: premieres },
  { id: 'anime-this-week', title: 'Airing this week', page: 20, job: animeThisWeek },
  { id: 'anime-returning', title: 'Returning anime', page: 20, job: returningAnime },
  { id: 'anime-next-season', title: 'Next season', page: 20, job: () => kitsuSeason(1) },
  { id: 'anime-top-rated', title: 'Top rated anime', page: 20, job: topRatedAnime },
  { id: 'movie-trending', title: 'Trending movies', page: 20, job: () => tmdbPages('movie', '/trending/movie/week') },
  { id: 'movie-popular', title: 'Popular movies', page: 20, job: () => tmdbPages('movie', `/movie/popular?region=${ROW_REGION}`) },
  { id: 'tv-trending', title: 'Trending shows', page: 20, job: trendingStreamingShows },
  { id: 'tv-popular', title: 'Popular shows', page: 24, job: popularStreamingShows },
  { id: 'kids-movie-trending', title: 'Trending kids movies', page: 20, job: trendingKidsMovies },
  { id: 'kids-movie-popular', title: 'Popular kids movies', page: 20, job: popularKidsMovies },
  { id: 'kids-tv-trending', title: 'Trending kids shows', page: 20, job: trendingKidsShows },
  { id: 'kids-tv-popular', title: 'Popular kids shows', page: 24, job: popularKidsShows },
  { id: 'anime-movie-trending', title: 'Trending anime movies', page: 22, job: trendingAnimeMovies },
  { id: 'anime-movie-popular', title: 'Popular anime movies', page: 25, job: popularAnimeMovies },
  { id: 'anime-trending', title: 'Trending anime', page: 22, job: trendingAnime },   // this season, most people listing it
  { id: 'anime-popular', title: 'Popular anime', page: 25, job: popularAnime },
  { id: 'kids-anime-trending', title: 'Trending kids anime', page: 22, job: trendingKidsAnime },
  { id: 'kids-anime-popular', title: 'Popular kids anime', page: 25, job: popularKidsAnime },
];
// per streaming service (US, subscription): trending and popular movies and shows, picked on the page by the service's logo.
// Trending: TMDB's trending this week (first 10 pages) that streams there, topped up while short with the service's most
// popular titles out in the last year; popular: its most popular (shows: premiered in the last 4 years, like the show rows).
// Anime and talk/news/kids shows stay out, as in the general rows
// anime: only anime there (Crunchyroll), so it has no movie or show rows and only the Anime page offers it
type Service = { id: string; name: string; ids: number[]; logo: string; anime?: boolean };
export const SERVICES: Service[] = [
  { id: 'netflix', name: 'Netflix', ids: [8], logo: '/rK1KljqmbvO9HQa1PBFLILWah72.png' },
  { id: 'prime', name: 'Prime Video', ids: [9], logo: '/gMZdpavHmxFNnLpMHwVxfqeux2g.png' },
  { id: 'hbo', name: 'HBO Max', ids: [1899], logo: '/skypuy7SXuugIQeYg0IglmzoKaS.png' },
  { id: 'apple', name: 'Apple TV+', ids: [350], logo: '/9icYBfYFcwgCbky5VdGUIKJ4C5i.png' },
  { id: 'disney', name: 'Disney+', ids: [337], logo: '/5eZ872CghnHFLB1j8grszbrx0dx.png' },
  { id: 'hulu', name: 'Hulu', ids: [15], logo: '/44uAnmSqvA4yBOdbPWN8YgQHjWm.png' },
  { id: 'paramount', name: 'Paramount+', ids: [2303, 2616], logo: '/4N4BMd0Mm0kHAmF7RZgL5lW3cwc.png' },
  { id: 'peacock', name: 'Peacock', ids: [386, 387], logo: '/a1UIdq5BrkcAxnxcUhFsNbXnxeu.png' },
  { id: 'crunchyroll', name: 'Crunchyroll', ids: [283], logo: '/uFL3c4Cq8M6WoLymlC5Y8bmGytV.png', anime: true },
];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const SERVICE_ROWS = [
  { id: 'movie-trending', title: 'Trending movies' }, { id: 'movie-popular', title: 'Popular movies' },
  { id: 'tv-trending', title: 'Trending shows' }, { id: 'tv-popular', title: 'Popular shows' },
  { id: 'anime-trending', title: 'Trending anime' }, { id: 'anime-popular', title: 'Popular anime' },
  { id: 'anime-movie-trending', title: 'Trending anime movies' }, { id: 'anime-movie-popular', title: 'Popular anime movies' },
];
// a service row's kind: movie, tv, anime (series) or anime-movie (the Anime page's films)
export const serviceRowKind = (id: string) => (id.startsWith('anime-movie-') ? 'anime-movie' : id.split('-')[0]);
const fitsRow = (type: 'movie' | 'tv') => (x: TmdbItem) => notAnime(x) && (type === 'movie' || !x.genre_ids?.some((g) => [10767, 10763, 10762].includes(g)));
const oncePerTitle = (list: Title[]) => { const seen = new Set<string>(); return list.filter((t) => !seen.has(byTitle(t)) && seen.add(byTitle(t))); };
const onService = (type: 'movie' | 'tv', sv: Service, extra: string) => `/discover/${type}?watch_region=US&with_watch_providers=${sv.ids.join('|')}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&${extra}`;
// service id -> row id -> title keys
export type ServiceRows = Record<string, Record<string, string[]>>;
// builds the services' rows into serviceRows (service id -> row id -> title keys)
async function refreshServices(serviceRows: ServiceRows) {
  const days = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  for (const type of ['movie', 'tv'] as const) {
    // which services each trending title streams on, looked up eight at a time
    // TMDB's pages can repeat a title as the list shifts while they're fetched
    const seen = new Set<number>();
    const trend = (await Promise.all(range(1, 10).map((pg) => tmdb<TmdbPage>(`/trending/${type}/week?page=${pg}`).then((d) => d.results, () => [] as TmdbItem[]))))
      .flat().filter((x) => fitsRow(type)(x) && !seen.has(x.id) && seen.add(x.id));
    const on = new Map<number, number[]>();
    for (let i = 0; i < trend.length; i += 8) {
      await Promise.all(trend.slice(i, i + 8).map(async (x) => {
        const w = await tmdb<TmdbWatchProviders>(`/${type}/${x.id}/watch/providers`).catch(() => null);
        on.set(x.id, (w?.results?.US?.flatrate || []).map((p) => p.provider_id));
      }));
    }
    for (const sv of SERVICES) {
      const rows = serviceRows[sv.id] ||= {};
      if (sv.anime) { delete rows[`${type}-trending`]; delete rows[`${type}-popular`]; continue; }
      try {
        const out = trend.filter((x) => on.get(x.id)?.some((id) => sv.ids.includes(id))).slice(0, 20).map(fromTmdb(type));
        if (out.length < 12) {
          const recent = await tmdbList(type, onService(type, sv, type === 'movie' ? `primary_release_date.gte=${days(365)}` : `first_air_date.gte=${days(365)}&${NO_TALK}`), fitsRow(type)).catch(() => []);
          for (const t of recent) if (out.length < 20 && !out.some((o) => o.key === t.key)) out.push(t);
        }
        rows[`${type}-trending`] = (await saveTitles(oncePerTitle(out))).map((t) => t.key);
      } catch (e) { console.error(`${sv.id} ${type}-trending: ${msg(e)}`); }
      try {
        const extra = type === 'movie' ? 'vote_count.gte=100' : `vote_count.gte=50&first_air_date.gte=${days(4 * 365)}&${NO_TALK}`;
        rows[`${type}-popular`] = (await saveTitles(oncePerTitle(await tmdbList(type, onService(type, sv, extra), fitsRow(type))))).map((t) => t.key);
      } catch (e) { console.error(`${sv.id} ${type}-popular: ${msg(e)}`); }
    }
  }
  // anime on each service (Japanese animation, TMDB), series and films apart (the Anime page's Series | Movies): trending = the
  // most popular series airing now (an episode in the last 90 days) and this year's films; popular = the most popular of each
  const ANIME = 'with_genres=16&with_original_language=ja';
  const keys = async (list: Title[], n: number) => (await saveTitles(oncePerTitle(list))).slice(0, n).map((t) => t.key);
  for (const sv of SERVICES) {
    const rows = serviceRows[sv.id] ||= {};
    try {
      const [tv, film] = await Promise.all([tmdbList('tv', onService('tv', sv, `${ANIME}&air_date.gte=${days(90)}`)), tmdbList('movie', onService('movie', sv, `${ANIME}&primary_release_date.gte=${days(365)}`))]);
      rows['anime-trending'] = await keys(tv, 20); rows['anime-movie-trending'] = await keys(film, 20);
    } catch (e) { console.error(`${sv.id} anime-trending: ${msg(e)}`); }
    try {
      const [tv, film] = await Promise.all([tmdbList('tv', onService('tv', sv, `${ANIME}&vote_count.gte=20`)), tmdbList('movie', onService('movie', sv, `${ANIME}&vote_count.gte=50`))]);
      rows['anime-popular'] = await keys(tv, 24); rows['anime-movie-popular'] = await keys(film, 24);
    } catch (e) { console.error(`${sv.id} anime-popular: ${msg(e)}`); }
  }
}
// the rows live in meta 'rows' ({ rows, services, servicesAt }): the worker builds them, the web app reads them (kept 30 s here)
// rows: row id -> title keys, and at: when they were built
type RowLists = { [id: string]: string[] | number; at: number };
type RowsMeta = { rows: RowLists; services: ServiceRows; servicesAt: number };
export const listOf = (rows: RowLists, id: string): string[] => { const v = rows[id]; return Array.isArray(v) ? v : []; };
let rowsCache: { at: number; value: RowsMeta | null } = { at: 0, value: null };
export async function rowsNow(): Promise<RowsMeta> {
  if (rowsCache.value && Date.now() - rowsCache.at < 30000) return rowsCache.value;
  const kept = await metaGet<Partial<RowsMeta>>('rows');
  const value = { rows: { at: 0, ...kept?.rows }, services: kept?.services || {}, servicesAt: kept?.servicesAt || 0 };
  rowsCache = { at: Date.now(), value };
  return value;
}
const keepRows = (r: RowsMeta) => { rowsCache = { at: Date.now(), value: r }; return metaSet('rows', r); };
export async function refreshServicesRows() {
  const r = await rowsNow(), services = structuredClone(r.services);
  await refreshServices(services).catch((e) => console.error(`services: ${msg(e)}`));
  const now = await rowsNow();
  await keepRows({ ...now, services, servicesAt: Date.now() });
}
// one card per title within a row (Kitsu can list a title twice)
const byTitle = (t: Title) => `${t.type}:${t.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
export async function refreshRows() {
  const r = await rowsNow(), rows: RowLists = { ...r.rows };
  for (const row of ROWS) {
    try {
      const seen = new Set<string>();
      const list = (await row.job()).filter((t) => !seen.has(byTitle(t)) && seen.add(byTitle(t)));
      const kept = rows[row.id];
      if (!list.length && Array.isArray(kept) && kept.length) { console.error(`${row.id}: nothing found, kept the last list`); continue; }
      rows[row.id] = (await saveTitles(list)).map((t) => t.key);
    } catch (e) { console.error(`${row.id}: ${msg(e)}`); }
  }
  rows.at = Date.now();
  await keepRows({ ...(await rowsNow()), rows });
  await prune();
  await refreshServicesRows();   // hundreds of provider lookups: last
}
// a page row is one type, named in its id ('anime-movie-trending'): anime rows are anime, else movie rows are movies
export const rowType = (id: string) => (/^(kids-)?anime/.test(id) ? 'anime' : /(^|-)movie(-|$)/.test(id) || id === 'theaters' ? 'movie' : 'series');
// titles saved before genres were kept: filled from TMDB in the background (those the catalogs can show: watchlist, history,
// rows), a few a second; Kitsu-only entries get theirs when MyAnimeList's rows bring them again
export async function fillGenres() {
  const keys = (await q.all<{ key: string }>(`select key from titles where genres is null and key like 'tmdb:%'
    and (key in (select key from watchlist) or key in (select key from history))`)).map((r) => r.key);
  const rowKeys = Object.values((await rowsNow()).rows).filter(Array.isArray).flat().filter((x) => x.startsWith('tmdb:'));
  const ts = await titlesOf(rowKeys);
  for (const k of [...new Set([...keys, ...rowKeys.filter((x) => !ts.get(x)?.genres)])]) {
    const [, type, id] = k.split(':');
    const d = await tmdb<TmdbDetails>(`/${type}/${id}`).catch(() => null);
    const g = d && tmdbGenres(d);
    if (g) await q.run('update titles set genres = ?::jsonb where key = ?', g, k);
    await new Promise((r) => setTimeout(r, 250));
  }
  if (keys.length) console.log(`genres: filled for ${keys.length} saved titles`);
}
export const liveServices = (serviceRows: ServiceRows) => SERVICES.filter((sv) => SERVICE_ROWS.some((r) => serviceRows[sv.id]?.[r.id]?.length));

// every row's titles get their card ready in the background (the worker), one at a time, so a first click opens it at once;
// again every 5 h, before the 6 h cache runs out (OMDb answers are kept 7 days, so its daily limit only pays for new titles)
let warming = false;
export async function warmDetails() {
  if (warming) return; warming = true;
  try {
    const { rows } = await rowsNow();
    const counted = (await q.all<{ key: string }>(`select distinct h.key from history h join titles t using (key) where t.type != 'movie' and t.episodes is null`)).map((r) => r.key);
    const keys = [...new Set([...ROWS.flatMap((r) => listOf(rows, r.id).slice(0, r.page)), ...counted])];
    const fresh = new Set((await q.all<{ key: string }>('select key from detail_cache where key = any(?) and at > ?', keys, Date.now() - 5 * HOUR)).map((r) => r.key));
    for (const k of keys) {
      if (fresh.has(k)) continue;
      await q.run('delete from detail_cache where key = ?', k);
      await details(k).catch(() => null);
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally { warming = false; }
}
