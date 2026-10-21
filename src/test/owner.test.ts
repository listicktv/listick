// The owner: a fresh instance's first account, from LISTICK_OWNER_*, made once and only while there are no users.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { pool } from '@/db';
import { q } from '@/server/db';
import { ensureOwner } from '@/server/owner';
import { ORIGIN, api, mails, resetDb, signIn } from './helpers';

before(() => resetDb());
after(() => { delete process.env.LISTICK_OWNER_NAME; delete process.env.LISTICK_OWNER_PASSWORD; return pool.end(); });

describe('owner', () => {
  test('without the settings no account is made', async () => {
    await ensureOwner();
    assert.equal((await q.one<{ n: number }>('select count(*)::int n from "user"'))!.n, 0);
  });
  test('the first visit makes the owner once', async () => {
    assert.equal((await api('/api/session', { method: 'POST', headers: { origin: ORIGIN } })).json.setup, true);
    const made = await api('/api/setup', { method: 'POST', body: { name: 'First', password: 'first-pass-123' }, headers: { origin: ORIGIN } });
    assert.equal(made.status, 200);
    assert.equal(made.json.user.admin, true);
    assert.ok(made.cookie);
    const again = await api('/api/setup', { method: 'POST', body: { name: 'Second', password: 'second-pass-123' }, headers: { origin: ORIGIN } });
    assert.equal(again.status, 403);
    assert.equal((await api('/api/session', { method: 'POST', headers: { origin: ORIGIN } })).json.setup, false);
    await q.run('delete from "user"');
  });
  test('a fresh instance gets the owner: an admin who signs in at once, with no email sent', async () => {
    process.env.LISTICK_OWNER_NAME = 'Owner'; process.env.LISTICK_OWNER_PASSWORD = 'owner-pass-123';
    const sent = mails.length;
    await ensureOwner();
    const me = await signIn('owner', 'owner-pass-123');
    const s = await me.get('/api/account');
    assert.equal(s.json.name, 'owner');
    assert.equal(s.json.admin, true);
    assert.equal(s.json.email, 'owner@listick.invalid');
    assert.equal(mails.length, sent);
  });
  test('once there are users the settings are ignored', async () => {
    process.env.LISTICK_OWNER_NAME = 'someone';
    await ensureOwner();
    assert.equal((await q.one<{ n: number }>('select count(*)::int n from "user"'))!.n, 1);
  });
});
