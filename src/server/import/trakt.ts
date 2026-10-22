// Trakt: history, ratings and watchlist from its export (a zip of JSON files, items as its API gives them).
import type { Ctx, Ref } from './run';

type Ids = { tmdb?: number | null; imdb?: string | null; tvdb?: number | null };
export type TraktItem = {
  type?: 'movie' | 'show' | 'season' | 'episode'; watched_at?: string; rated_at?: string; listed_at?: string; rating?: number;
  movie?: { ids: Ids; year?: number | null }; show?: { ids: Ids }; season?: { number: number }; episode?: { season: number; number: number; ids?: Ids };
};
export type TraktData = { history: TraktItem[]; ratings: TraktItem[]; watchlist: TraktItem[] };
// a movie, a show (with season / episode) as a reference by its TMDB id, else its IMDb id
const refOf = (x: { ids: Ids } | undefined, type: 'movie' | 'tv'): Ref | null =>
  (x?.ids.tmdb ? { tmdb: { type, id: x.ids.tmdb } } : x?.ids.imdb ? { imdb: x.ids.imdb } : null);
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : Date.now());

// what an item is, from its type or (the export's rating files) its fields
const kind = (x: TraktItem) => x.type || (x.episode ? 'episode' : x.season ? 'season' : x.movie ? 'movie' : 'show');
// Trakt keeps the release date as the time when something was marked watched without a date: that's a date unknown (approx 1)
const unknownDate = (x: TraktItem) => !!x.watched_at && (x.watched_at < '2000' || (!!x.movie?.year && x.watched_at.startsWith(String(x.movie.year)) && x.watched_at.endsWith('T00:00:00.000Z')));
async function history(ctx: Ctx, items: TraktItem[]) {
  for (const x of items) {
    const k = kind(x), approx = unknownDate(x) ? 1 : 0;
    if (k === 'movie') { const ref = refOf(x.movie, 'movie'); if (ref) await ctx.play(ref, -1, -1, ms(x.watched_at), approx); }
    else if (k === 'episode' && x.episode) { const ref = refOf(x.show, 'tv'); if (ref) await ctx.play(ref, x.episode.season, x.episode.number, ms(x.watched_at), approx, x.episode.ids); }
  }
}
async function ratings(ctx: Ctx, items: TraktItem[]) {
  for (const x of items) {
    if (!x.rating) continue;
    const k = kind(x), ref = k === 'movie' ? refOf(x.movie, 'movie') : refOf(x.show, 'tv');
    if (!ref) continue;
    const se = k === 'season' ? x.season!.number : k === 'episode' ? x.episode!.season : -1, ep = k === 'episode' ? x.episode!.number : -1;
    await ctx.rate(ref, se, ep, x.rating, ms(x.rated_at), k === 'episode' ? x.episode!.ids : undefined);
  }
}
async function watchlist(ctx: Ctx, items: TraktItem[]) {
  for (const x of items) {
    const k = kind(x), ref = k === 'movie' ? refOf(x.movie, 'movie') : k === 'show' ? refOf(x.show, 'tv') : null;
    if (ref) await ctx.want(ref, ms(x.listed_at));
  }
}
export async function traktFileImport(ctx: Ctx, data: TraktData) {
  await history(ctx, data.history);
  await ratings(ctx, data.ratings);
  await watchlist(ctx, data.watchlist);
}
