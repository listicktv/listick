// Who the worker's live job refreshes, and when, so it keeps up with many users: everyone (Up next comes from the History); users active
// in the last 30 days every round (15 s), the rest every 30 minutes (Stremio's watched record still
// shows what they watched in between, with coarser times). A user whose refresh fails waits longer each time (30 s, 1 min,
// 2 min, … up to 30 minutes). Several users run at once, up to a cap, so one slow source doesn't hold the others up.
import type { User } from './types';
import { env, msg } from './util';

export const IDLE_MS = 30 * 60_000;
type Next = { at: number; fails: number };
const next = new Map<string, Next>();
const concurrency = () => Math.max(1, Number(env('LIVE_CONCURRENCY')) || 4);

// fn over the items, at most n at a time
export async function inParallel<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x); }));
}

// one round: the users due now, refreshed; returns how many were
export async function pollRound(users: User[], active: Set<string>, refresh: (u: User) => Promise<unknown>, now = Date.now(), n = concurrency()) {
  const due = users.filter((u) => (next.get(u.id)?.at ?? 0) <= now);
  await inParallel(due, n, async (u) => {
    try {
      await refresh(u);
      next.set(u.id, { at: active.has(u.id) ? 0 : now + IDLE_MS, fails: 0 });
    } catch (e) {
      const fails = (next.get(u.id)?.fails ?? 0) + 1;
      next.set(u.id, { at: now + Math.min(IDLE_MS, 15_000 * 2 ** fails), fails });
      console.error(`live: ${u.name}: ${msg(e)} (try ${fails}, next in ${Math.round(Math.min(IDLE_MS, 15_000 * 2 ** fails) / 1000)} s)`);
    }
  });
  return due.length;
}
export const resetPoller = () => next.clear();
