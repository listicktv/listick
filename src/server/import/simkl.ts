// Simkl: movies, shows and anime from its export (Simkl Pro: a zip with one JSON file, read as its API's items: Simkl doesn't
// document its fields, so an unexpected shape imports nothing). Each item carries your status (plantowatch = Plan to watch),
// your rating and each episode watched and when.
import type { Ctx, Ref } from './run';

type Ids = { tmdb?: number | string | null; imdb?: string | null; mal?: number | string | null; kitsu?: number | string | null };
type Episode = { number: number; watched_at?: string | null };
export type SimklItem = {
  status?: string; last_watched_at?: string | null; user_rating?: number | null; user_rated_at?: string | null; added_to_watchlist_at?: string | null;
  movie?: { ids: Ids }; show?: { ids: Ids }; seasons?: { number: number; episodes?: Episode[] }[]; episodes?: Episode[];
};
const num = (x: number | string | null | undefined) => (x == null || x === '' ? null : Number(x) || null);
// a movie or show by its TMDB id (IMDb otherwise); anime by its Kitsu or MAL entry, else its TMDB show
function refOf(ids: Ids | undefined, type: 'movie' | 'tv', anime: boolean): Ref | null {
  if (!ids) return null;
  if (anime && num(ids.kitsu)) return { kitsu: num(ids.kitsu)! };
  if (anime && num(ids.mal)) return { mal: num(ids.mal)! };
  if (num(ids.tmdb)) return { tmdb: { type, id: num(ids.tmdb)! } };
  return ids.imdb ? { imdb: ids.imdb } : null;
}
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

export type SimklData = Record<'movies' | 'shows' | 'anime', SimklItem[]>;
export async function simklFileImport(ctx: Ctx, data: SimklData) {
  for (const type of ['movies', 'shows', 'anime'] as const) await items(ctx, type, data[type] || []);
}
async function items(ctx: Ctx, type: 'movies' | 'shows' | 'anime', list: SimklItem[]) {
  for (const x of list) {
    const anime = type === 'anime', ref = refOf((x.movie || x.show)?.ids, type === 'movies' || (anime && x.movie) ? 'movie' : 'tv', anime);
    if (!ref) continue;
    if (x.status === 'plantowatch') { await ctx.want(ref, ms(x.added_to_watchlist_at) ?? Date.now()); continue; }
    if (type === 'movies' || x.movie) {
      // a completed film: when it was last watched, or with no date, once on its release day
      if (x.status === 'completed') {
        const at = ms(x.last_watched_at) ?? await ctx.released(ref);
        if (at) await ctx.play(ref, -1, -1, at, x.last_watched_at ? 0 : 1);
      }
    } else {
      // episodes: anime are numbered per entry (season 1), shows by their seasons; an episode without a time gets the last watched one
      const seasons = x.seasons?.length ? x.seasons : x.episodes?.length ? [{ number: 1, episodes: x.episodes }] : [];
      for (const s of seasons) for (const e of s.episodes || []) {
        const at = ms(e.watched_at) ?? ms(x.last_watched_at);
        if (at) await ctx.play(ref, anime ? 1 : s.number, e.number, at, e.watched_at ? 0 : 2);
      }
    }
    if (x.user_rating) await ctx.rate(ref, -1, -1, x.user_rating, ms(x.user_rated_at) ?? Date.now());
  }
}
