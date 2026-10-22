// The /api routes end to end against a test database: sign-in, the write guards, marks, ratings, the watchlist, title cards, the
// public API, and the outside-call counts.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { pool } from '@/db';
import { q } from '@/server/db';
import { flushCalls } from '@/server/sources';
import { addTitles, addUser, api, calls, fixtures, ORIGIN, resetDb, signIn, title } from './helpers';

const MATRIX = 'tmdb:movie:603', SHOW = 'tmdb:tv:1399';
const TMDB_MATRIX = { id: 603, title: 'The Matrix', release_date: '1999-03-31', poster_path: '/m.jpg', vote_average: 8.2, overview: 'Neo.',
  genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }], runtime: 136, external_ids: { imdb_id: 'tt0133093' } };

before(async () => {
  await resetDb();
  fixtures({ '/3/movie/603?': TMDB_MATRIX });
  await addUser('alice');
  await addTitles(title(MATRIX, { title: 'The Matrix' }), title(SHOW, { title: 'Game of Thrones', episodes: 73 }));
});
after(() => pool.end());

describe('signing in', () => {
  test('signed out: the config is public, the session is not', async () => {
    assert.deepEqual((await api('/api/config')).json, { name: 'Listick', captcha: null, mail: true, weather: false, sources: { mal: false, omdb: false, tvdb: false } });
    assert.equal((await api('/api/session', { method: 'POST', headers: { origin: ORIGIN } })).status, 401);
  });
  test('an address with a broken escape is refused, not an error', async () => {
    assert.equal((await (await signIn('alice', 'password-123', '198.51.100.20')).get('/api/title/%E0%A4%A')).status, 400);
  });
  test('the instance\'s name is a setting', async () => {
    process.env.APP_NAME = 'Listick.tv';
    assert.equal((await api('/api/config')).json.name, 'Listick.tv');
    delete process.env.APP_NAME;
  });
  test('a wrong password is refused, the right one signs in with a CSRF token', async () => {
    const bad = await api('/api/login', { method: 'POST', body: { name: 'alice', password: 'nope-nope' }, headers: { origin: ORIGIN } });
    assert.equal(bad.status, 403);
    const me = await signIn('alice');
    assert.match(me.csrf, /^[0-9a-f]{64}$/);
    assert.equal((await me.get('/api/account')).json.name, 'alice');
  });
  test('the 11th try from one address within 10 minutes is refused', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await api('/api/login', { method: 'POST', body: { name: 'alice', password: 'wrong-wrong' }, headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7' } })).status);
    assert.deepEqual(statuses, [...Array(10).fill(403), 429]);
  });
  test('addresses a client writes in front of the proxy\'s don\'t get it more tries', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await api('/api/login', { method: 'POST', body: { name: 'alice', password: 'wrong-wrong' }, headers: { origin: ORIGIN, 'x-forwarded-for': `10.9.9.${i}, 203.0.113.8` } })).status);
    assert.deepEqual(statuses, [...Array(10).fill(403), 429]);
  });
  test('a sign-in from another site is refused', async () => {
    const r = await api('/api/login', { method: 'POST', body: { name: 'alice', password: 'password-123' }, headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  });
});

describe('writes', () => {
  test('need the CSRF token and the page\'s origin', async () => {
    const me = await signIn('alice');
    const noToken = await api(`/api/rate/${MATRIX}`, { method: 'POST', body: { rating: 8 }, headers: { cookie: me.cookie, origin: ORIGIN } });
    assert.deepEqual([noToken.status, noToken.json], [403, { error: 'session' }]);
    const elsewhere = await api(`/api/rate/${MATRIX}`, { method: 'POST', body: { rating: 8 }, headers: { cookie: me.cookie, origin: 'https://evil.example', 'x-listick-token': me.csrf } });
    assert.deepEqual([elsewhere.status, elsewhere.json], [403, { error: 'origin' }]);
  });
  test('a rating is kept to one decimal, out-of-range ones are refused, null removes it', async () => {
    const me = await signIn('alice');
    assert.equal((await me.post(`/api/rate/${MATRIX}`, { rating: 7.46 })).status, 200);
    assert.equal((await q.one<{ rating: number }>('select rating from ratings where key = ?', MATRIX))!.rating, 7.5);
    assert.equal((await me.post(`/api/rate/${MATRIX}`, { rating: 11 })).status, 400);
    await me.post(`/api/rate/${MATRIX}`, { rating: null });
    assert.equal(await q.one('select 1 from ratings where key = ?', MATRIX), undefined);
  });
  test('marking: a second play within 2 hours is the same watch; un-marking removes only the latest', async () => {
    const me = await signIn('alice'), ep = { season: 1, episodes: [1], watched: true };
    const day = Date.now() - 2 * 86400000;
    assert.deepEqual((await me.post(`/api/mark/${SHOW}`, { ...ep, at: day })).json, { changed: 1, left: 1 });
    assert.deepEqual((await me.post(`/api/mark/${SHOW}`, { ...ep, at: day + 10 * 60000 })).json, { changed: 0, left: 1 });
    assert.deepEqual((await me.post(`/api/mark/${SHOW}`, { ...ep, at: day + 31 * 60000 })).json, { changed: 0, left: 1 });
    assert.deepEqual((await me.post(`/api/mark/${SHOW}`, { ...ep, at: day + 86400000 })).json, { changed: 1, left: 2 });
    assert.deepEqual((await me.post(`/api/mark/${SHOW}`, { season: 1, episodes: [1], watched: false })).json, { changed: 1, left: 1 });
    assert.equal((await me.post(`/api/mark/${SHOW}`, { ...ep, at: Date.now() + 86400000 })).status, 400);
  });
  test('a poster\'s Watched on a title TMDB has no date for goes on its year\'s middle; one not out yet is refused', async () => {
    const OLD = 'tmdb:movie:7001', PLANNED = 'tmdb:movie:7002';
    fixtures({ '/3/movie/603?': TMDB_MATRIX, '/3/movie/7001?': { id: 7001, title: 'Old One', release_date: '', status: 'Released' },
      '/3/movie/7002?': { id: 7002, title: 'Someday', release_date: '', status: 'Planned' } });
    await addTitles(title(OLD, { title: 'Old One', year: 1990 }), title(PLANNED, { title: 'Someday' }));
    const me = await signIn('alice');
    assert.equal((await me.post(`/api/mark/${OLD}`, { watched: true, at: 'unknown' })).status, 200);
    assert.equal((await q.one<{ watched_at: number }>('select watched_at from history where key = ?', OLD))!.watched_at, Date.UTC(1990, 6, 1, 19));
    const r = await me.post(`/api/mark/${PLANNED}`, { watched: true, at: 'unknown' });
    assert.deepEqual([r.status, r.json], [400, { error: "it isn't out yet" }]);
  });
  test('the watchlist takes known titles only and shows on the summary', async () => {
    const me = await signIn('alice');
    assert.equal((await me.post('/api/watchlist/add/tmdb:movie:999999')).status, 404);
    assert.equal((await me.post(`/api/watchlist/add/${MATRIX}`)).status, 200);
    const s = await me.get('/api/summary');
    assert.equal(s.status, 200);
    assert.deepEqual(s.json.media.watchlist.map((t: { key: string }) => t.key), [MATRIX]);
    await me.post(`/api/watchlist/remove/${MATRIX}`);
    assert.deepEqual((await me.get('/api/summary')).json.media.watchlist, []);
  });
});

describe('title cards', () => {
  test('come from TMDB once, then from the cache', async () => {
    const me = await signIn('alice');
    const first = await me.get(`/api/title/${MATRIX}`);
    assert.equal(first.status, 200);
    assert.equal(first.json.title, 'The Matrix');
    assert.deepEqual(first.json.genres, ['Action', 'Science Fiction']);
    assert.equal(first.json.imdb, 'tt0133093');
    const fetched = calls.filter((u) => u.includes('/movie/603')).length;
    await me.get(`/api/title/${MATRIX}`);
    assert.equal(calls.filter((u) => u.includes('/movie/603')).length, fetched);
  });
  test('a malformed key is refused', async () => {
    const me = await signIn('alice');
    assert.equal((await me.get('/api/title/nope')).status, 400);
  });
  test('outside calls are counted per day, role and service', async () => {
    await flushCalls();
    const r = await q.one<{ calls: number }>("select calls from api_calls where role = 'web' and service = 'tmdb'");
    assert.ok(r && r.calls >= 1);
  });
});

describe('calendar and addon APIs', () => {
  test('the calendar feed opens with its own link only', async () => {
    const me = await signIn('alice');
    const key = (await me.post('/api/account/apikey/calendar')).json.apiKeys.find((k: { id: string }) => k.id === 'calendar').key;
    const feed = await api(`/api/v1/calendar/${key}.ics`);
    assert.equal(feed.status, 200);
    assert.match(feed.json, /^BEGIN:VCALENDAR\r\n/);
    assert.match(feed.json, /END:VCALENDAR\r\n$/);
    assert.equal((await api('/api/v1/calendar/not-a-real-calendar-key.ics')).status, 404);
    assert.equal((await api(`/api/calendar/${key}.ics`)).status, 200, 'the first address still works');
  });
  test('the API reads a user\'s lists with an app key that has the lists scope', async () => {
    const me = await signIn('alice');
    const keys = (await me.post('/api/account/apikey/catalogs')).json.apiKeys, key = keys.find((k: { id: string }) => k.id === 'catalogs').key;
    const as = (k: string) => ({ headers: { authorization: `Bearer ${k}` } });
    assert.equal((await api('/api/v1/me')).status, 401);
    assert.equal((await api('/api/v1/me', as(key))).json.app, 'catalogs');
    const cal = (await me.post('/api/account/apikey/calendar')).json.apiKeys.find((k: { id: string }) => k.id === 'calendar').key;
    assert.equal((await api('/api/v1/lists', as(cal))).status, 403, 'a calendar key has no lists scope');
    assert.equal((await api(`/api/v1/calendar/${key}.ics`)).status, 404, 'a catalogs key opens no calendar');
    await me.post(`/api/watchlist/add/${MATRIX}`);
    fixtures({ '/3/movie/603?': TMDB_MATRIX, '/3/movie/603/external_ids': { imdb_id: 'tt0133093' } });
    assert.ok((await api('/api/v1/lists', as(key))).json.lists.some((l: { src: string }) => l.src === 'plan'));
    const plan = (type: string, filter = '') => api(`/api/v1/lists/plan?type=${encodeURIComponent(type)}${filter}`, as(key));
    assert.deepEqual((await plan('For You')).json.items.map((t: { key: string; id: string }) => [t.key, t.id]), [[MATRIX, 'tt0133093']]);
    assert.equal((await q.one<{ imdb: string }>('select imdb from titles where key = ?', MATRIX))!.imdb, 'tt0133093', 'kept for next time');
    assert.deepEqual((await plan('For You', '&filter=Series')).json.items, []);
    assert.deepEqual((await plan('For You', '&filter=Movies')).json.items.map((t: { type: string }) => t.type), ['movie']);
  });
});

describe('outside data', () => {
  test('every call out says who is asking', async () => {
    const agents: string[] = [];
    globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => { agents.push(new Headers(init?.headers).get('user-agent') || ''); return Response.json({ results: [] }); }) as typeof fetch;
    await (await import('@/server/sources')).fetchCounted('https://api.themoviedb.org/3/search/movie?query=x');
    assert.match(agents[0], /^Listick\/1\.0 \(\+http:\/\/localhost:3000/);
  });
  test('TMDB titles older than 5 months are fetched again, so none outlives TMDB\'s 6-month limit', async () => {
    fixtures({ '/3/movie/603': { ...TMDB_MATRIX, overview: 'Fresh overview.' } });
    await q.run('update titles set fetched_at = ? where key = ?', Date.now() - 200 * 86400000, MATRIX);
    const { refreshOldTitles } = await import('@/server/titles');
    assert.equal(await refreshOldTitles(), 1);
    const t = await q.one<{ fetched_at: number; overview: string }>('select fetched_at, overview from titles where key = ?', MATRIX);
    assert.ok(Date.now() - t!.fetched_at < 60000);
    assert.equal(t!.overview, 'Fresh overview.');
  });
});
