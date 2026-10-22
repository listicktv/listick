// AniList-keyed API (Seanime plugin)
import { upNextKeys } from './catalogs';
import { q } from './db';
import { listKeys } from './lists';
import { anilistOf, placeOfAnilist } from './mapping';
import { addPlay } from './plays';
import { getState, setState } from './store';
import { getTitle, titlesOf } from './titles';
import type { Title } from './types';

type Now = { key: string; se: number; ep: number; pct: number | null; at: number; until: number };
type Item = { anilistId: number; key: string; title: string; year: number | null; poster: string | null; episode?: number };
const LIST_MAX = 100;
const isAnime = (t: Title) => t.anime === 1 || t.type === 'anime';

async function items(list: { key: string; se?: number; ep?: number }[]) {
  const ts = await titlesOf(list.map((x) => x.key)), out: Item[] = [], seen = new Set<number>();
  for (const x of list) {
    const t = ts.get(x.key);
    if (!t || !isAnime(t)) continue;
    const a = await anilistOf(t.key, x.se ?? -1, x.ep ?? -1);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ anilistId: a.id, key: t.key, title: t.title, year: t.year, poster: t.poster, ...(a.ep > 0 ? { episode: a.ep } : {}) });
    if (out.length >= LIST_MAX) break;
  }
  return out;
}
export async function animeOf(uid: string) {
  const plan = await q.all<{ key: string }>('select key from watchlist where user_id = ? order by added_at desc', uid);
  const lists = [];
  for (const l of await q.all<{ id: string; name: string }>('select id, name from lists where user_id = ? order by position, created_at', uid)) {
    const its = await items(((await listKeys(uid, l.id)) || []).map((key) => ({ key })));
    if (its.length) lists.push({ id: l.id, name: l.name, items: its });
  }
  return { upNext: await items(await upNextKeys(uid, 60)), plan: await items(plan), lists };
}

// state: playing | stopped | watched
export async function animePlay(uid: string, app: string, b: Record<string, unknown>) {
  const id = b.anilistId, ep = b.episode, state = b.state;
  if (!Number.isInteger(id) || !Number.isInteger(ep) || (ep as number) < 1 || (ep as number) > 5000 || !['playing', 'stopped', 'watched'].includes(state as string))
    return { code: 400, body: { error: 'anilistId, episode (1-5000), state: playing, stopped or watched' } };
  if (state === 'stopped') { await setState(uid, app, 'now', null); return { code: 200, body: { ok: true } }; }
  const place = await placeOfAnilist(id as number, ep as number);
  if (!place) return { code: 404, body: { error: 'no such anime' } };
  const at = Date.now();
  if (state === 'playing') {
    const pct = typeof b.progress === 'number' && Number.isFinite(b.progress) ? Math.max(0, Math.min(100, Math.round(b.progress))) : null;
    await setState(uid, app, 'now', { ...place, pct, at, until: at + 10 * 60000 } satisfies Now);
    return { code: 200, body: { ok: true, playing: true } };
  }
  await setState(uid, app, 'now', null);
  const recorded = await addPlay(uid, place.key, place.se, place.ep, at, app);
  const t = await getTitle(place.key);
  if (recorded) await setState(uid, app, 'last', { at, name: `${t?.title || 'An anime'} · ${place.se < 0 ? 'Movie' : `E${ep}`}` });
  return { code: 200, body: { ok: true, recorded } };
}
export async function animeNow(uid: string, app: string) {
  const n = await getState<Now | null>(uid, app, 'now');
  return n && n.until > Date.now() ? n : null;
}
