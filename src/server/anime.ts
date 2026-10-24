// AniList-keyed API (Seanime plugin)
import { upNextKeys } from './catalogs';
import { q } from './db';
import { forYouOf } from './foryou';
import { appLists, builtinKeys } from './lists';
import { anilistOf, placeOfAnilist } from './mapping';
import { addPlay } from './plays';
import { ROWS, listOf as rowKeys, rowType, rowsNow } from './rows';
import { saveResume } from './resume';
import { getState, setState } from './store';
import { getTitle, titlesOf } from './titles';
import type { Title } from './types';

type Now = { key: string; se: number; ep: number; pct: number | null; at: number; until: number };
type Item = { anilistId: number; key: string; title: string; year: number | null; poster: string | null; episode?: number };
const MAX = 50;
const isAnime = (t: Title) => t.anime === 1 || t.type === 'anime';

// the first MAX anime of a list, read 100 titles at a time
async function items(list: { key: string; se?: number; ep?: number }[]) {
  const out: Item[] = [], seen = new Set<number>();
  for (let i = 0; i < list.length && out.length < MAX; i += 100) {
    const part = list.slice(i, i + 100), ts = await titlesOf(part.map((x) => x.key));
    for (const x of part) {
      const t = ts.get(x.key);
      if (!t || !isAnime(t)) continue;
      const a = await anilistOf(t.key, x.se ?? -1, x.ep ?? -1);
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ anilistId: a.id, key: t.key, title: t.title, year: t.year, poster: t.poster, ...(a.ep > 0 ? { episode: a.ep } : {}) });
      if (out.length >= MAX) break;
    }
  }
  return out;
}
const keyed = (keys: string[]) => keys.map((key) => ({ key }));
type Group = { id: string; name: string; owner?: string; items: Item[] };
export async function animeOf(uid: string) {
  const plan = await q.all<{ key: string }>('select key from watchlist where user_id = ? order by added_at desc', uid);
  const lists: Group[] = [], discover: Group[] = [];
  for (const l of await appLists(uid)) {
    const its = await items(keyed(l.keys));
    if (its.length) lists.push({ id: l.id, name: l.name, ...(l.owner ? { owner: l.owner } : {}), items: its });
  }
  for (const id of ['watched', 'rated'] as const) {
    const b = await builtinKeys(uid, id), its = await items(keyed(b.keys));
    if (its.length) lists.push({ id, name: b.name, items: its });
  }
  const fy = await items(keyed(((await forYouOf(uid))?.suggested || []).map((s) => s.key)));
  if (fy.length) discover.push({ id: 'foryou', name: 'For you', items: fy });
  const { rows } = await rowsNow();
  for (const r of ROWS.filter((x) => rowType(x.id) === 'anime')) {
    const its = await items(keyed(rowKeys(rows, r.id)));
    if (its.length) discover.push({ id: r.id, name: r.title, items: its });
  }
  return { upNext: await items(await upNextKeys(uid, 60)), plan: await items(plan), lists, discover };
}

// state: playing | stopped | watched
export async function animePlay(uid: string, app: string, b: Record<string, unknown>) {
  const id = b.anilistId, ep = b.episode, state = b.state;
  if (!Number.isInteger(id) || !Number.isInteger(ep) || (ep as number) < 1 || (ep as number) > 5000 || !['playing', 'stopped', 'watched'].includes(state as string))
    return { code: 400, body: { error: 'anilistId, episode (1-5000), state: playing, stopped or watched' } };
  if (state === 'stopped') {
    // Continue watching: the last progress sent, 5 to 90 % in
    const n = await getState<Now | null>(uid, app, 'now');
    if (n && n.pct != null && n.pct >= 5 && n.pct < 90) await saveResume(uid, app, { key: n.key, se: n.se, ep: n.ep, pct: n.pct, at: Date.now() });
    await setState(uid, app, 'now', null);
    return { code: 200, body: { ok: true } };
  }
  const place = await placeOfAnilist(id as number, ep as number);
  if (!place) return { code: 404, body: { error: 'no such anime' } };
  const at = Date.now();
  if (state === 'playing') {
    const pct = typeof b.progress === 'number' && Number.isFinite(b.progress) ? Math.max(0, Math.min(100, Math.round(b.progress))) : null;
    await setState(uid, app, 'now', { ...place, pct, at, until: at + 10 * 60000 } satisfies Now);
    // Continue watching: 5 to 90 % in
    if (pct != null && pct >= 5 && pct < 90) await saveResume(uid, app, { key: place.key, se: place.se, ep: place.ep, pct, at });
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
