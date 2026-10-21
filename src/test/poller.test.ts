// The live job's scheduling: who is refreshed each round, idle users less often, failures backing off, a cap on parallel work.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { IDLE_MS, inParallel, pollRound, resetPoller } from '@/server/poller';
import type { User } from '@/server/types';

const user = (id: string, connected = true): User => ({ id, name: id, first_name: null, email: null, created_at: 0, admin: false,
  stremio_key: connected ? 'key' : null, stremio_user: null, tracking_since: null });
const users = [user('active'), user('idle'), user('none', false)];
beforeEach(resetPoller);

describe('pollRound', () => {
  test('active users every round, idle ones every 30 minutes, with Stremio or without (Up next is from the History)', async () => {
    const seen: string[] = [], refresh = async (u: User) => { seen.push(u.id); };
    const active = new Set(['active']), t0 = 1_000_000;
    await pollRound(users, active, refresh, t0);
    await pollRound(users, active, refresh, t0 + 15_000);
    await pollRound(users, active, refresh, t0 + IDLE_MS);
    assert.deepEqual(seen, ['active', 'idle', 'none', 'active', 'active', 'idle', 'none']);
  });
  test('a failing user waits longer each time, then is back to normal once it works', async () => {
    let failing = true;
    const tries: number[] = [], refresh = async () => { tries.push(1); if (failing) throw new Error('stremio down'); };
    const one = [user('a')], active = new Set(['a']);
    let t = 0;
    for (const step of [0, 15_000, 30_000, 60_000, 120_000]) { t += step; await pollRound(one, active, refresh, t); }
    // 0 s fails (next at 30 s), 15 s skipped, 45 s fails (next at 105 s), 105 s fails (next at 225 s), 225 s fails
    assert.equal(tries.length, 4);
    failing = false;
    await pollRound(one, active, refresh, t + 10 * 60_000);
    await pollRound(one, active, refresh, t + 10 * 60_000 + 15_000);
    assert.equal(tries.length, 6);   // working again: every round
  });
});

describe('inParallel', () => {
  test('never runs more than n at once, and runs them all', async () => {
    let now = 0, peak = 0;
    const done: number[] = [];
    await inParallel([1, 2, 3, 4, 5, 6, 7], 3, async (x) => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 5)); now--; done.push(x); });
    assert.equal(peak, 3);
    assert.deepEqual(done.sort(), [1, 2, 3, 4, 5, 6, 7]);
  });
});
