// What's playing now: what a player says is playing (Jellyfin, Seanime), or a Stremio item saved in the last 4 minutes, on its Listick
// title and episode
import { STREMIO_LIVE } from '@/lib/cards';
import { animeNow } from './anime';
import { jellyfinNow } from './jellyfin';
import { liveOf } from './store';
import { titlesOf } from './titles';

export type Watching = { source: string; key: string; se: number; ep: number; pct: number | null; at: number };
export async function watchingOf(uid: string): Promise<Watching[]> {
  const out: Watching[] = [];
  const j = await jellyfinNow(uid);
  if (j) out.push({ source: 'jellyfin', key: j.key, se: j.se, ep: j.ep, pct: j.pct, at: j.at });
  const s = await animeNow(uid, 'seanime');
  if (s && !out.some((w) => w.key === s.key)) out.push({ source: 'seanime', key: s.key, se: s.se, ep: s.ep, pct: s.pct, at: s.at });
  for (const c of (await liveOf(uid)).stremio?.continue || [])
    if (c.resume && c.place && Date.now() - c.at < STREMIO_LIVE && !out.some((w) => w.key === c.place!.key))
      out.push({ source: 'stremio', key: c.place.key, se: c.place.se ?? -1, ep: c.place.ep ?? -1, pct: c.pct ?? null, at: c.at });
  return out;
}
// the same with each title's name and artwork, for Home's Continue watching
export async function watchingCards(uid: string) {
  const w = await watchingOf(uid), ts = await titlesOf(w.map((x) => x.key));
  return w.flatMap((x) => { const t = ts.get(x.key); return t ? [{ ...x, title: t.title, type: t.type, poster: t.poster, backdrop: t.backdrop }] : []; });
}
