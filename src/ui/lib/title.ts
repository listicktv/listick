// A title's card (/api/title/<key>): what the title panel shows, loaded ahead when you point at a card.
import { createContext, useContext } from 'react';
import { getJ } from './api';
import type { Ref, Tile, TitleType } from './media';

export type Season = { n: number; name: string; episodes: number | null; year: number | null };
export type Play = { at: number; approx?: number | null; source?: string; plays?: number };
export type Episode = { ep: number; name: string | null; air: string | null; runtime: number | null; still: string | null; overview: string | null; tvdb?: boolean; se?: number; tep?: number;
  watched?: Play | null; mine?: number | null };
export type Title = {
  key: string; type: TitleType; title: string; label: string | null; year: number | null; poster: string | null; backdrop: string | null;
  rating: number | null; ratingSrc: string | null; overview: string | null; url: string | null; genres: string[]; runtime: number | null;
  released: string | null; status: string | null; tagline: string | null; seasons: Season[] | null; seasonsTvdb?: Season[] | null;
  next: { season?: number; ep?: number; date: string | null } | null; people: { label: string; names: string[] } | null;
  cast: { name: string | undefined; role: string | null; photo: string | null }[]; imdb: string | null;
  scores?: { imdb: string | null; votes: string | null; rt: string | null; mc: string | null; awards: string | null; pages?: { rt: string | null; mc: string | null } } | null;
  certification: string | null; trailer: string | null; writers?: string[]; money?: { budget: number | null; revenue: number | null };
  anime?: boolean; mal?: { score: number | null; rank: number | null; url: string }; kitsu?: { score: number | null; url: string }; facts?: Record<string, string | number | null>;
  episodes?: number | null; format?: string | null; malUrl?: string | null;
  watchlist: boolean; upNext: string | null; similar: Tile[]; collectionItems: Tile[];
  watching?: { source: string; se: number; ep: number; pct: number | null } | null;
  you?: { plays?: number; episodes?: number; bySeason?: Record<number, number>; bySeasonTvdb?: Record<number, number>; rating?: number | null; first?: number | null; last?: number | null;
    moviePlays?: Play[]; seasonRatings?: Record<number, number>; seasonAvg?: Record<number, number> };
};

export const titleUrl = (key: string) => `/api/title/${encodeURIComponent(key)}`;
// pointing at a title (or touching it) starts loading its card, so the click finds it ready; used once and only while fresh
// (10 s), so a card never opens with marks from before a change
const prefetched = new Map<string, { at: number; p: Promise<Title> }>();
export function prefetch(ref: Ref) {
  if (!('key' in ref)) return;
  const had = prefetched.get(ref.key); if (had && Date.now() - had.at < 10000) return;
  const p = getJ<Title>(titleUrl(ref.key)); p.catch(() => {}); prefetched.set(ref.key, { at: Date.now(), p });
}
// { key } directly, or { imdb } resolved by Listick first
export async function loadTitle(ref: Ref) {
  let key = 'key' in ref ? ref.key : undefined;
  if (!key) key = (await getJ<{ key?: string }>(`/api/resolve?${new URLSearchParams({ imdb: (ref as { imdb: string }).imdb })}`)).key;
  if (!key) throw new Error('not found on TMDB or Kitsu');
  const pre = prefetched.get(key); prefetched.delete(key);
  if (pre && Date.now() - pre.at < 10000) { const t = await pre.p.catch(() => null); if (t) return t; }
  return getJ<Title>(titleUrl(key));
}

// what the card's parts need from the panel: redraw from a fresh card, the date wheels, the trailer
export type PickArgs = { anchor: HTMLElement; air: number | null; save: (at: number | true, range: boolean, fromAir: boolean) => unknown; keepTime?: boolean;
  airDay?: number | true | null; airLabel?: string; run?: { label: string } | null };
// backRef: what Back (and Escape) closes before the window itself, such as an episode's page; true when it closed something
export type TitleState = { reloadTitle: () => Promise<void>; pickDay: (a: PickArgs) => void; playTrailer: (url: string) => void; backRef: { current: (() => boolean) | null } };
export const TitleCtx = createContext<TitleState>({ reloadTitle: async () => {}, pickDay: () => {}, playTrailer: () => {}, backRef: { current: null } });
export const useTitle = () => useContext(TitleCtx);
