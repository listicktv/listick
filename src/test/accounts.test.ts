// Accounts: sign-up by invite, exporting your data and deleting your account.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { pool } from '@/db';
import * as authRoute from '@/app/api/auth/[...all]/route';
import { q } from '@/server/db';
import { addTitles, addUser, api, fixtures, mails, ORIGIN, resetDb, signIn, title } from './helpers';

const SHOW = 'tmdb:tv:1399';
const register = (name: string, extra: Record<string, unknown> = {}) => api('/api/register', { method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': `192.0.2.${name.length}` },
  body: { first: 'Bo', name, email: `${name}@example.com`, password: 'password-123', ...extra } });

before(async () => {
  await resetDb();
  fixtures({});
  await addUser('owner');   // the first account is the owner
  await addTitles(title(SHOW, { title: 'Game of Thrones' }));
});
after(() => pool.end());

describe('sign-up', () => {
  test('there is no sign-up without an invite', async () => {
    const r = await register('nobody');
    assert.deepEqual([r.status, r.json], [403, { error: 'sign-up is by invite: ask for a link' }]);
  });
  test('an invite makes the account and signs it in at once, with no confirmation email', async () => {
    await q.run('update profiles set is_admin = true where user_id = (select id from "user" where username = ?)', 'owner');
    const owner = await signIn('owner');
    const { link } = (await owner.post('/api/invites')).json;
    const token = new URL(link).searchParams.get('invite');
    assert.equal((await api(`/api/invite?token=${token}`)).status, 200);
    const sent = mails.length;
    const r = await register('bo', { invite: token });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.name, 'bo');
    assert.equal(r.json.csrf.length, 64);
    assert.equal(mails.length, sent);
    assert.equal((await register('again', { invite: token })).status, 403);   // a link is good once
  });
  test('an admin makes an account: no session or cookie for it, it signs in with its password, the admin stays signed in', async () => {
    const owner = await signIn('owner');
    const r = await owner.post('/api/users', { name: 'Cy', email: 'cy@example.com', password: 'password-456' });
    assert.equal(r.status, 200);
    assert.equal(r.cookie, '');
    assert.equal((await q.one<{ n: number }>('select count(*)::int n from session s join "user" u on u.id = s.user_id where u.username = ?', 'cy'))!.n, 0);
    assert.equal((await signIn('cy', 'password-456')).csrf.length, 64);
    assert.equal((await owner.post('/api/session')).json.user.name, 'owner');
  });
  test('admins see the invites made, used or open, and can take an open one back', async () => {
    const owner = await signIn('owner');
    const token = new URL((await owner.post('/api/invites')).json.link).searchParams.get('invite')!;
    const list = (await owner.get('/api/invites')).json.invites as { id: string; open: boolean; usedBy: string | null }[];
    assert.ok(list.some((x) => x.usedBy === 'bo'));
    const mine = list.find((x) => x.open)!;
    assert.equal((await owner.post(`/api/invites/${mine.id}/revoke`)).status, 200);
    assert.equal((await api(`/api/invite?token=${token}`)).status, 404);
    assert.equal((await register('late', { invite: token })).status, 403);
    assert.equal((await (await signIn('bo')).get('/api/invites')).status, 403);   // not for everyone
  });
  test('two sign-ups with one invite at once: only one gets the account', async () => {
    const owner = await signIn('owner');
    const token = new URL((await owner.post('/api/invites')).json.link).searchParams.get('invite');
    const [a, b] = await Promise.all([register('twin-a', { invite: token }), register('twin-bb', { invite: token })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 403]);
    assert.equal((await q.one<{ n: number }>(`select count(*)::int n from "user" where username like 'twin-%'`))!.n, 1);
  });
  test('a used or broken confirmation link (a changed email) lands with an error', async () => {
    const v = await authRoute.GET(new Request(`${ORIGIN}/api/auth/verify-email?token=broken&callbackURL=%2F%3Fverified%3D1`));
    assert.equal(v.status, 302);
    assert.match(v.headers.get('location')!, /^\/\?verified=1&error=/);
  });
  test('Better Auth\'s own endpoints are closed: no sign-up around the invite, no sign-in around the limit', async () => {
    assert.equal('POST' in authRoute, false);
    for (const path of ['sign-up/email', 'get-session', 'list-sessions']) assert.equal((await authRoute.GET(new Request(`${ORIGIN}/api/auth/${path}`))).status, 404);
  });
});

describe('your data', () => {
  test('the export has your history and ratings but no keys or tokens', async () => {
    const me = await signIn('bo');
    await me.post(`/api/mark/${SHOW}`, { season: 1, episodes: [2], watched: true, at: Date.now() - 86400000 });
    await me.post(`/api/rate/${SHOW}`, { rating: 9 });
    await me.post('/api/account/stremio', { key: 'k'.repeat(30) });
    const r = await me.get('/api/account/export');
    assert.equal(r.status, 200);
    assert.equal(r.json.format, 'listick-export');
    assert.equal(r.json.account.username, 'bo');
    assert.deepEqual(r.json.history.map((h: { title: string; episode: unknown }) => [h.title, h.episode]), [['Game of Thrones', { season: 1, episode: 2 }]]);
    assert.equal(r.json.ratings[0].rating, 9);
    assert.equal(r.json.connections.stremio, true);
    assert.ok(!JSON.stringify(r.json).includes('k'.repeat(30)));
  });
  test('deleting takes your password and removes everything of yours', async () => {
    const me = await signIn('bo');
    assert.equal((await me.post('/api/account/delete', { password: 'wrong-wrong' })).status, 403);
    assert.equal((await me.post('/api/account/delete', { password: 'password-123' })).status, 200);
    assert.equal(await q.one(`select 1 from "user" where username = 'bo'`), undefined);
    assert.equal((await q.one<{ n: number }>('select count(*) n from history'))!.n, 0);
    assert.equal((await me.get('/api/account')).status, 401);
  });
  test('the owner\'s account stays', async () => {
    const me = await signIn('owner');
    const r = await me.post('/api/account/delete', { password: 'password-123' });
    assert.deepEqual([r.status, r.json], [403, { error: "the owner's account stays" }]);
  });
});
