// Plays and ratings: the one way a watch gets into the history, marks, ratings and play times changed by hand.
import { q } from './db';
import { HOUR } from './util';

// your marks: episodes or a movie watched (now), or not: un-marking removes only the latest play of each, so older ones
// (imported dates, rewatches) stay; and your rating
const latestPlay = (uid: string, key: string, se: number, ep: number) => q.run(`delete from history where id = (select id from history where user_id = ? and key = ? and season = ? and episode = ?
  order by watched_at desc limit 1)`, uid, key, se, ep);
const playsLeft = async (uid: string, key: string, se: number, ep: number) => (await q.one<{ n: number }>('select count(*) n from history where user_id = ? and key = ? and season = ? and episode = ?', uid, key, se, ep))!.n;
// at: when (several episodes end a minute apart, the last at that time); times: each episode's own (their air dates)
// approx 1: the date is unknown (kept on the release day)
type MarkOpts = { season?: number; episodes?: number[]; watched: boolean; at?: number; times?: number[] | null; approx?: number };
export async function mark(uid: string, key: string, { season: se = -1, episodes = [-1], watched, at = Date.now(), times = null, approx = 0 }: MarkOpts) {
  let changed = 0;
  if (watched) for (const [i, ep] of episodes.entries()) changed += await addPlay(uid, key, se, ep, times ? times[i] : at - (episodes.length - 1 - i) * 60000, 'manual', approx);
  else for (const ep of episodes) changed += (await latestPlay(uid, key, se, ep)).changes;
  return { changed, left: episodes.length === 1 ? await playsLeft(uid, key, se, episodes[0]) : null };
}
// a play's time changed by hand (the title card's "Watched …" label): that one play, found by its current time
export const retime = async (uid: string, key: string, se: number, ep: number, from: number, at: number) => (await q.run(`update history set watched_at = ?, approx = 0 where id = (select id from history where user_id = ? and key = ? and season = ?
  and episode = ? and watched_at = ? limit 1)`, at, uid, key, se, ep, from)).changes;
// the title (season and episode -1), a season (episode -1) or an episode
export async function rate(uid: string, key: string, rating: number | null, se = -1, ep = -1) {
  if (rating == null) return (await q.run('delete from ratings where user_id = ? and key = ? and season = ? and episode = ?', uid, key, se, ep)).changes;
  return (await q.run(`insert into ratings (user_id, key, season, episode, rating, rated_at, source) values (?, ?, ?, ?, ?, ?, 'manual')
    on conflict (user_id, key, season, episode) do update set rating = excluded.rating, rated_at = excluded.rated_at, source = 'manual'`, uid, key, se, ep, rating, Date.now())).changes;
}

// ---------- plays: the one way a watch gets into the history, from any source ----------
// A second play of the same title/episode within 2 h (an episode) or 6 h (a movie: no rewatch fits in its own runtime and a
// break) is the same watch recorded twice, so it is skipped; the earliest stays. (Stremio's record can bring one episode in
// twice half an hour apart.)
const DOUBLE = { episode: 2 * HOUR, movie: 6 * HOUR };
const windowOf = (s: number) => (s === -1 ? DOUBLE.movie : DOUBLE.episode);
export const nearPlay = (uid: string, key: string, se: number, ep: number, from: number, to: number) => q.one('select 1 from history where user_id = ? and key = ? and season = ? and episode = ? and watched_at between ? and ? limit 1', uid, key, se, ep, from, to);
// a play takes the title off Plan to watch: a movie watched, a show or anime started (any of its episodes)
export async function insertPlay(uid: string, key: string, se: number, ep: number, at: number, approx: number, source: string) {
  const r = await q.run(`insert into history (user_id, key, season, episode, watched_at, approx, source) values (?, ?, ?, ?, ?, ?, ?) on conflict do nothing`,
    uid, key, se, ep, at, approx, source);
  if (r.changes) await q.run('delete from watchlist where user_id = ? and key = ?', uid, key);
  return r;
}
export async function addPlay(uid: string, key: string, se: number, ep: number, at: number, source: string, approx = 0) {
  const w = windowOf(se);
  if (await nearPlay(uid, key, se, ep, at - w, at + w)) return 0;
  return (await insertPlay(uid, key, se, ep, at, approx, source)).changes;
}
// the same rule over what is already stored, everyone's (imports run it at the end; the worker at start)
export async function collapseDoubles() {
  type H = { id: number; user_id: string; key: string; season: number; episode: number; watched_at: number };
  const rows = await q.all<H>('select id, user_id, key, season, episode, watched_at from history order by user_id, key, season, episode, watched_at');
  const drop: number[] = [];
  let kept: H | null = null;
  for (const r of rows) {
    if (kept && kept.user_id === r.user_id && kept.key === r.key && kept.season === r.season && kept.episode === r.episode && r.watched_at - kept.watched_at < windowOf(r.season)) drop.push(r.id);
    else kept = r;
  }
  if (drop.length) await q.run('delete from history where id = any(?)', drop);
  return drop.length;
}
