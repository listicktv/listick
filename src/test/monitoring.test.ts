// What an uptime monitor and the alert channel see: the health check (with and without the worker) and rate-limited alerts.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { GET } from '@/app/api/health/route';
import { pool } from '@/db';
import { alert } from '@/server/alert';
import { q } from '@/server/db';
import { resetDb } from './helpers';

before(resetDb);
after(() => pool.end());
const health = async (query = '') => { const r = await GET(new Request(`http://localhost:3000/api/health${query}`)); return { status: r.status, json: await r.json() }; };

describe('health', () => {
  test('without a worker heartbeat: fine for the container, failing for the monitor', async () => {
    assert.deepEqual([(await health()).status, (await health()).json.worker], [200, 'stale']);
    assert.equal((await health('?worker')).status, 503);
  });
  test('with a fresh heartbeat both pass; an old one fails the monitor again', async () => {
    await q.run(`insert into job_runs (job, last_run_at) values ('heartbeat', now())`);
    assert.deepEqual([(await health('?worker')).status, (await health('?worker')).json.worker], [200, 'ok']);
    await q.run(`update job_runs set last_run_at = now() - interval '5 minutes' where job = 'heartbeat'`);
    assert.equal((await health('?worker')).status, 503);
  });
});

describe('alerts', () => {
  test('go to the webhook once an hour per kind', async () => {
    const posts: string[] = [];
    globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => { posts.push(JSON.parse(String(init?.body)).content); return new Response('', { status: 204 }); }) as typeof fetch;
    process.env.ALERT_WEBHOOK = 'https://discord.example/webhook';
    await alert('job failed: rows', 'TMDB answered 500');
    await alert('job failed: rows', 'TMDB answered 500 again');
    await alert('job failed: live', 'Stremio timed out');
    assert.deepEqual(posts, ['**Listick web** · job failed: rows\nTMDB answered 500', '**Listick web** · job failed: live\nStremio timed out']);
    delete process.env.ALERT_WEBHOOK;
  });
});
