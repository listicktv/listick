// Where a player (Jellyfin, Seanime) stopped partway, one per title, for Home's Continue watching: kept until that episode or a
// later one is played, the card is removed here, or 60 days pass
import { q } from './db';
import { setState } from './store';
import { titlesOf } from './titles';

export type Resume = { key: string; se: number; ep: number; pct: number | null; at: number };
const APPS = ['jellyfin', 'seanime'];
const KEEP = 60 * 86400000;

export const saveResume = (uid: string, app: string, r: Resume) => setState(uid, app, `resume:${r.key}`, r);

export async function resumeOf(uid: string) {
  const rows = await q.all<{ source: string; state: Resume }>(`select source, state from sync_state where user_id = ? and source = any(?) and item like 'resume:%'`, uid, APPS);
  const hidden = new Map((await q.all<{ item: string; state: { at?: number } | null }>("select item, state from sync_state where user_id = ? and source = 'cw-hide'", uid))
    .map((r) => [r.item, r.state?.at ?? -1]));
  const out: (Resume & { source: string })[] = [];
  for (const { source, state: r } of rows) {
    if (!r || Date.now() - r.at > KEEP || (hidden.get(`${source}:${r.key}|${r.se}:${r.ep}`) ?? -1) >= r.at) continue;
    const played = await q.one(`select 1 from history where user_id = ? and key = ? and (season > ? or (season = ? and episode >= ?)) and watched_at >= ? limit 1`,
      uid, r.key, r.se, r.se, r.ep, r.at);
    if (!played) out.push({ ...r, source });
  }
  return out;
}
export async function resumeCards(uid: string) {
  const r = await resumeOf(uid), ts = await titlesOf(r.map((x) => x.key));
  return r.flatMap((x) => { const t = ts.get(x.key); return t ? [{ ...x, title: t.title, type: t.type, poster: t.poster, backdrop: t.backdrop }] : []; });
}
