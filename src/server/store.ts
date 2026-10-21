// Users and per-user state in Postgres: Better Auth's users with Listick's profiles, sync_state, meta and live_state.
import { q } from './db';
import type { LiveValue, Uid, User } from './types';

// ---------- users ----------
// Better Auth's user row (username = sign-in name, name = first name) with Listick's profile
const USER_SQL = `select u.id, u.username as name, u.name as first_name, u.email, (extract(epoch from u.created_at) * 1000)::bigint as created_at,
  coalesce(p.is_admin, false) as admin, p.stremio_key, p.stremio_user, p.tracking_since
  from "user" u left join profiles p on p.user_id = u.id`;
export const getUser = async (uid: Uid | undefined) => (uid ? q.one<User>(`${USER_SQL} where u.id = ?`, uid) : null);
export const allUsers = () => q.all<User>(`${USER_SQL} order by u.created_at`);
// the owner: the first admin
let owner: string | null = null;
export async function ownerId() {
  if (owner) return owner;
  owner = (await q.one<{ user_id: string }>(`select p.user_id from profiles p join "user" u on u.id = p.user_id order by p.is_admin desc, u.created_at limit 1`))?.user_id || null;
  return owner;
}
// Listick's own fields of a user (profiles), made on first use
type ProfileFields = Partial<{ is_admin: boolean; stremio_key: string | null; stremio_user: string | null; tracking_since: number }>;
export const setProfile = (uid: string, fields: ProfileFields) => {
  const cols = Object.keys(fields) as (keyof ProfileFields)[];
  return q.run(`insert into profiles (user_id, ${cols.join(', ')}) values (?, ${cols.map(() => '?').join(', ')})
    on conflict (user_id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`, uid, ...cols.map((c) => fields[c]));
};
// an uid of null (a title fetched for no one, e.g. while tracking) matches no one's rows, so personal fields come out empty
export const watchKeys = async (uid: Uid) => new Set((await q.all<{ key: string }>('select key from watchlist where user_id = ?', uid)).map((r) => r.key));
// each user's bookkeeping per source (what Stremio showed last, hidden cards, sign-ins in progress): an object, or null
export const getState = async <T>(uid: string, source: string, item: string) =>
  (await q.one<{ state: T }>('select state from sync_state where user_id = ? and source = ? and item = ?', uid, source, item))?.state ?? null;
export const setState = (uid: string, source: string, item: string, state: unknown) => q.run(`insert into sync_state (user_id, source, item, state) values (?, ?, ?, ?::jsonb)
  on conflict (user_id, source, item) do update set state = excluded.state`, uid, source, item, JSON.stringify(state));
export const metaGet = async <T>(k: string) => (await q.one<{ v: T | null }>('select v from meta where k = ?', k))?.v ?? null;
export const metaSet = (k: string, v: unknown) => q.run('insert into meta (k, v) values (?, ?::jsonb) on conflict (k) do update set v = excluded.v', k, JSON.stringify(v));
export async function liveOf(uid: Uid): Promise<LiveValue & { at: number }> {
  const r = uid ? await q.one<{ at: number; value: LiveValue }>('select at, value from live_state where user_id = ?', uid) : null;
  return r ? { ...r.value, at: r.at } : { stremio: null, forYou: null, at: 0 };
}
// users who used Listick in the last `days` days: a session made or refreshed then
export const activeUsers = async (days = 30) => new Set((await q.all<{ user_id: string }>(
  'select distinct user_id from session where updated_at > now() - make_interval(days => ?)', days)).map((r) => r.user_id));
