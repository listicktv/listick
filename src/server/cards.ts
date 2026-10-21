// Titles as cards for one user: their plays, rating and what's next on each.
import { q } from './db';
import { tvSeasons, tvSeasonsCache } from './mapping';
import { langOf, namesOf, posterAt } from './names';
import { titlesOf } from './titles';
import type { Title, TitleType, Uid, View } from './types';
import { present } from './util';

// ---------- your numbers on a card (batched: one query each for a whole list of titles) ----------
// per title: plays (distinct episodes or movie plays), regular episodes seen, last dated play, furthest episode, your rating
type LastEp = { season: number; episode: number };
type Stats = { n: number; reg: number; lastAt: number | null; lastEp: LastEp | null; mine: number | null };
async function statsOf(uid: Uid, keys: string[]) {
  const out = new Map<string, Stats>(), want = [...new Set(keys)];
  if (!uid || !want.length) return out;
  const get = (k: string) => out.get(k) || out.set(k, { n: 0, reg: 0, lastAt: null, lastEp: null, mine: null }).get(k)!;
  for (const r of await q.all<{ key: string; n: number; reg: number; last_at: number | null }>(`select key, count(distinct season || ':' || episode) n, count(distinct case when season > 0 then season || ':' || episode end) reg,
    max(watched_at) filter (where approx != 1) last_at from history where user_id = ? and key = any(?) group by key`, uid, want)) Object.assign(get(r.key), { n: r.n, reg: r.reg, lastAt: r.last_at });
  for (const r of await q.all<{ key: string; season: number; episode: number }>(`select distinct on (key) key, season, episode from history where user_id = ? and key = any(?) and season > 0
    order by key, season desc, episode desc`, uid, want)) get(r.key).lastEp = { season: r.season, episode: r.episode };
  for (const r of await q.all<{ key: string; rating: number }>('select key, rating from ratings where user_id = ? and key = any(?) and season = -1 and episode = -1', uid, want)) get(r.key).mine = r.rating;
  return out;
}
const NO_STATS: Stats = { n: 0, reg: 0, lastAt: null, lastEp: null, mine: null };
// progress: the share of a show's episodes (specials left out) you have watched, for the poster circle's ring; lastAt: your
// latest dated play; next: nextUp's words
const viewWith = (t: Title | null, wl: Set<string>, s: Stats): View | null => t && ({ key: t.key, type: t.type, title: t.title, label: t.label, year: t.year, poster: t.poster, backdrop: t.backdrop,
  rating: t.rating, ratingSrc: t.rating_src, url: t.url, watchlist: wl.has(t.key), watched: s.n, mine: s.mine ?? null,
  progress: t.type !== 'movie' && t.episodes ? Math.min(1, s.reg / t.episodes) : null,
  lastAt: s.lastAt || null, next: nextUpFrom(t, s.lastEp) });
// titles (rows of titles, or null) as cards for uid, named in uid's language where that's known (names.ts)
export async function viewsOf(uid: Uid, list: (Title | null)[], wl: Set<string>) {
  const keys = list.filter(present).map((t) => t.key), stats = await statsOf(uid, keys), names = await namesOf(keys, await langOf(uid));
  return list.map((t) => { const v = viewWith(t, wl, (t && stats.get(t.key)) || NO_STATS), n = t && names.get(t.key);
    return v && n ? { ...v, title: n.title || v.title, poster: posterAt(n.poster, 'w342') || v.poster } : v; });
}
// keys as cards, in order, missing titles left out
export async function cardsOf(uid: Uid, keys: string[], wl: Set<string>) {
  const ts = await titlesOf(keys);
  return (await viewsOf(uid, keys.map((k) => ts.get(k) || null), wl)).filter(present);
}
export const playCount = async (uid: string, key: string) => (await q.one<{ n: number }>(`select count(distinct season || ':' || episode) n from history where user_id = ? and key = ?`, uid, key))!.n;

// ---------- the page's cards: what's next ----------
// the episode after the furthest one you've watched, as the poster circle's words: "S2 E4", or "E12" for a one-season anime;
// null once you're past the last one TMDB lists. Season lengths come from tvSeasons' cache, filled in the background on a
// miss (until then the next episode in the same season)
type NextOf = { key: string; type: TitleType; anime?: number | boolean | null };
export function nextEpFrom(t: NextOf, e: LastEp | null | undefined) {
  if (t.type === 'movie' || !e) return null;
  const id = Number(/^tmdb:tv:(\d+)$/.exec(t.key)?.[1]) || null;
  const seasons = id && tvSeasonsCache.get(id)?.list;
  if (id && !seasons) tvSeasons(id).catch(() => {});
  let se = e.season, ep = e.episode + 1;
  if (seasons && seasons.length) {
    const cur = seasons.find((x) => x.n === se);
    if (cur && ep > cur.count) { const nx = seasons.find((x) => x.n > se); if (!nx) return null; se = nx.n; ep = 1; }
  }
  return { se, ep, oneSeason: !seasons || seasons.length === 1 };
}
export function nextUpFrom(t: NextOf, e: LastEp | null | undefined) {
  const n = nextEpFrom(t, e);
  return n && ((t.type === 'anime' || t.anime) && n.oneSeason && n.se === 1 ? `E${n.ep}` : `S${n.se} E${n.ep}`);
}
export const lastEpOf = (uid: Uid, key: string) => q.one<LastEp>('select season, episode from history where user_id = ? and key = ? and season > 0 order by season desc, episode desc limit 1', uid, key);
export const nextUp = async (t: NextOf, uid: Uid) => (t.type === 'movie' ? null : nextUpFrom(t, await lastEpOf(uid, t.key)));
