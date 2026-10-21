// Titles: the titles table, and TMDB and Kitsu entries as titles (names, genres, artwork).
import { q } from './db';
import { TMDB_IMG, tmdb } from './sources';
import type { KitsuResource, TmdbDetails, KitsuTitle, Title, TmdbItem, TmdbPage } from './types';
import { HOUR, present } from './util';

// ---------- titles ----------
// a source that doesn't send a field keeps the stored one (e.g. a poster borrowed from TMDB for a Kitsu entry)
const TITLE_COLS = ['key', 'type', 'title', 'label', 'year', 'poster', 'backdrop', 'rating', 'rating_src', 'overview', 'url', 'fetched_at', 'anime', 'episodes', 'genres'] as const;
export async function saveTitles<T extends Title>(list: T[]): Promise<T[]> {
  const last = new Map<string, Title>();
  // genres go in as JSON text: from a source as genreJson made it, from a stored row (asTmdb hands those back) as an array
  for (const t of list) last.set(t.key, { ...t, anime: t.anime ?? null, episodes: t.episodes ?? null, genres: Array.isArray(t.genres) ? JSON.stringify(t.genres) : t.genres ?? null });
  const rows = [...last.values()];
  for (let i = 0; i < rows.length; i += 2000) {
    const part = rows.slice(i, i + 2000), params: unknown[] = [];
    const values = part.map((t) => `(${TITLE_COLS.map((c) => { params.push(t[c] ?? null); return c === 'genres' ? '?::jsonb' : '?'; }).join(', ')})`).join(', ');
    await q.run(`insert into titles (${TITLE_COLS.join(', ')}) values ${values}
      on conflict (key) do update set title = excluded.title, label = coalesce(excluded.label, titles.label), year = coalesce(excluded.year, titles.year),
        poster = coalesce(excluded.poster, titles.poster), backdrop = coalesce(excluded.backdrop, titles.backdrop), rating = coalesce(excluded.rating, titles.rating),
        rating_src = case when excluded.rating is null then titles.rating_src else excluded.rating_src end,
        overview = coalesce(excluded.overview, titles.overview), url = excluded.url, fetched_at = excluded.fetched_at,
        anime = coalesce(excluded.anime, titles.anime), episodes = coalesce(excluded.episodes, titles.episodes), genres = coalesce(excluded.genres, titles.genres)`, ...params);
  }
  return list;
}
export const getTitle = (key: string) => q.one<Title>('select * from titles where key = ?', key);
// many titles at once, by key
export async function titlesOf(keys: (string | null | undefined)[]) {
  const want = [...new Set(keys.filter(present))];
  const out = new Map<string, Title>();
  if (want.length) for (const t of await q.all<Title>('select * from titles where key = any(?)', want)) out.set(t.key, t);
  return out;
}
// an anime's own genres where the anime-genres job found them (TMDB's are few and loose for anime: Sci-Fi & Fantasy as one)
export const genresOf = (t: Title | null | undefined) => (t?.anime_genres?.length ? t.anime_genres : Array.isArray(t?.genres) ? t.genres : []);
// titles the watchlist doesn't hold, older than 6 months (TMDB's caching limit), are dropped
export const prune = () => q.run(`delete from titles where fetched_at < ? and key not in (select key from watchlist)
  and key not in (select key from history) and key not in (select key from ratings) and key not in (select key from list_items)`, Date.now() - 182 * 24 * HOUR);

// display names: decorative symbols become spaces ("Magical★Explorer"), and a trailing season/part moves to a short label
const SEASON = /[\s:,-]*(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season|part\s*(\d+)|cour\s*(\d+))\s*$/i;
export function cleanTitle(raw: string | null | undefined) {
  let title = String(raw || '').replace(/[★☆♥♡♪◆◇●○■□♦✿]/g, ' ').replace(/\s+/g, ' ').trim(), label: string | null = null;
  const m = title.match(SEASON);
  if (m && m.index! > 0) { const n = m[1] || m[2]; label = n ? `S${n}` : `Part ${m[3] || m[4]}`; title = title.slice(0, m.index).trim(); }
  return { title, label };
}
// genres as one set of names for movies, shows and anime: TMDB's ids (movie and TV lists, /genre/<type>/list) and MyAnimeList's
// names map onto them; TMDB's news, talk, soap and TV-movie genres and MAL's themes and demographics are left out
const TMDB_GENRES: Record<number, string[]> = { 28: ['Action'], 12: ['Adventure'], 10759: ['Action', 'Adventure'], 16: ['Animation'], 35: ['Comedy'], 80: ['Crime'],
  99: ['Documentary'], 18: ['Drama'], 10751: ['Family'], 14: ['Fantasy'], 10765: ['Sci-Fi', 'Fantasy'], 878: ['Sci-Fi'], 36: ['History'],
  27: ['Horror'], 10402: ['Music'], 9648: ['Mystery'], 10749: ['Romance'], 53: ['Thriller'], 10752: ['War'], 10768: ['War'],
  37: ['Western'], 10762: ['Kids'], 10764: ['Reality'] };
export const MAL_GENRES: Record<string, string> = { Action: 'Action', Adventure: 'Adventure', Comedy: 'Comedy', Drama: 'Drama', Fantasy: 'Fantasy', Horror: 'Horror',
  Mystery: 'Mystery', Romance: 'Romance', 'Sci-Fi': 'Sci-Fi', 'Slice of Life': 'Slice of Life', Sports: 'Sports', Supernatural: 'Supernatural',
  Suspense: 'Thriller', Mecha: 'Mecha', Psychological: 'Psychological', Isekai: 'Isekai', Music: 'Music', School: 'School' };
// the genre filter's choices per Stremio type (the manifest is read once, at import, so they're fixed)
export const GENRE_OPTIONS: Record<string, string[]> = {
  movie: ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'],
  series: ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Kids', 'Mystery', 'Reality', 'Sci-Fi', 'War', 'Western'],
  anime: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Isekai', 'Mecha', 'Mystery', 'Psychological', 'Romance', 'School', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'],
};
// genres travel as JSON text into the jsonb column
export const genreJson = (names: string[]) => { const u = [...new Set(names)]; return u.length ? JSON.stringify(u) : null; };
export const tmdbGenres = (x: TmdbItem) => genreJson([...(x.genre_ids || []), ...(x.genres || []).map((g) => g.id)].flatMap((id) => TMDB_GENRES[id] || []));
export const fromTmdb = (type: 'movie' | 'tv') => (x: TmdbItem): Title => ({
  key: `tmdb:${type}:${x.id}`, type, ...cleanTitle(x.title || x.name),
  year: Number((x.release_date || x.first_air_date || '').slice(0, 4)) || null,
  poster: x.poster_path ? `${TMDB_IMG}w342${x.poster_path}` : null,
  backdrop: x.backdrop_path ? `${TMDB_IMG}w780${x.backdrop_path}` : null,
  rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null, rating_src: 'tmdb',
  overview: x.overview || null, url: `https://www.themoviedb.org/${type}/${x.id}`, fetched_at: Date.now(),
  anime: x.original_language === 'ja' && ((x.genre_ids || []).includes(16) || (x.genres || []).some((g) => g.id === 16)) ? 1 : 0,
  // only a show's full record has its seasons (list results don't)
  episodes: type === 'tv' && x.seasons ? x.seasons.filter((s) => s.season_number > 0).reduce((n, s) => n + (s.episode_count || 0), 0) || null : null,
  genres: tmdbGenres(x),
});
// Kitsu's synopses end with where they came from ("(Source: ANN)", "[Written by MAL Rewrite]"): not shown
export const cleanSynopsis = (t: string | null | undefined) => (t ? t.replace(/\s*[([](?:source|written by)[^)\]]*[)\]]\s*$/i, '').trim() || null : null);
export const fromKitsu = (x: KitsuResource): KitsuTitle => {
  const a = x.attributes;
  return {
    alt: [a.titles?.en, a.canonicalTitle, a.titles?.en_jp].filter(present), english: !!a.titles?.en,
    key: `kitsu:anime:${x.id}`, type: 'anime', ...cleanTitle(a.titles?.en || a.titles?.en_jp || a.canonicalTitle),
    year: Number((a.startDate || '').slice(0, 4)) || null,
    poster: a.posterImage?.medium || a.posterImage?.large || null,
    backdrop: a.coverImage?.large || a.coverImage?.original || null,
    rating: a.averageRating ? Math.round(Number(a.averageRating)) / 10 : null, rating_src: 'kitsu',
    overview: cleanSynopsis(a.synopsis), url: `https://kitsu.app/anime/${a.slug}`, fetched_at: Date.now(), anime: 1, episodes: a.episodeCount || null,
    genres: null,
  };
};
// TMDB fills what Kitsu lacks: a poster for brand-new entries, an English name where Kitsu has only the Japanese one
export async function fillFromTmdb(list: KitsuTitle[]): Promise<Title[]> {
  for (const t of list.filter((x) => !x.poster || !x.english)) {
    const hit = await tmdbAnime(t.alt || []);
    if (!hit) continue;
    if (!t.poster && hit.poster_path) t.poster = `${TMDB_IMG}w342${hit.poster_path}`;
    if (!t.english && hit.name && /^[\x20-\x7E’–—]+$/.test(hit.name)) { const c = cleanTitle(hit.name); t.title = c.title; t.label = t.label || c.label; }
  }
  return list.map(({ alt, english, ...t }) => t);
}
async function tmdbAnime(titles: string[]) {
  for (const s of [...new Set(titles.map((x) => cleanTitle(x).title))]) {
    const r = await tmdb<TmdbPage>(`/search/tv?query=${encodeURIComponent(s)}`).catch(() => null);
    const hit = r?.results?.find((x) => x.genre_ids?.includes(16)) || r?.results?.[0];
    if (hit) return hit;
  }
  return null;
}
export const KEY = /^(tmdb:(movie|tv)|kitsu:anime):\d+$/;
// TMDB's content may be cached 6 months at most: TMDB titles fetched over 5 months ago are fetched again (a few hundred a day,
// by the worker), so the ones history, ratings and lists keep never go past it; one TMDB no longer has stays until prune
// finds nothing of anyone's uses it
export async function refreshOldTitles(limit = 300) {
  const old = await q.all<{ key: string }>(`select key from titles where key like 'tmdb:%' and fetched_at < ? order by fetched_at limit ?`, Date.now() - 150 * 24 * HOUR, limit);
  let n = 0;
  for (const { key } of old) {
    const [, type, id] = key.split(':') as [string, 'movie' | 'tv', string];
    const d = await tmdb<TmdbDetails>(`/${type}/${id}`).catch(() => null);
    if (d) { await saveTitles([fromTmdb(type)(d)]); n++; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (n) console.log(`titles: ${n} older than 5 months fetched again from TMDB`);
  return n;
}
