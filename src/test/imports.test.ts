// Imports end to end: offering them to a new account and each service's export file (Trakt, Simkl, Letterboxd), run by the
// worker's runner against fixtures; the same file again adds nothing.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { pool } from '@/db';
import { q } from '@/server/db';
import { runNextImport } from '@/server/import/run';
import { addUser, fixtures, resetDb, signIn } from './helpers';
import { LETTERBOXD, TRAKT_EXPORT, zip } from './fixtures';

const MATRIX = { id: 603, title: 'The Matrix', release_date: '1999-03-31', poster_path: '/m.jpg', vote_average: 8.2 };
const GOT = { id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17', poster_path: '/g.jpg', vote_average: 8.4 };
const TMDB = { '/3/movie/603': MATRIX, '/3/tv/1399': GOT, '/3/search/movie?query=The%20Matrix': { results: [MATRIX] },
  '/3/search/movie?query=Dune%3A%20Part%20Two': { results: [{ id: 693134, title: 'Dune: Part Two', release_date: '2024-02-27' }] },
  '/3/movie/693134': { id: 693134, title: 'Dune: Part Two', release_date: '2024-02-27' }, '/3/search/movie': { results: [] } };
const count = async (table: string, uid: string) => (await q.one<{ n: number }>(`select count(*) n from ${table} where user_id = ?`, uid))!.n;

before(async () => {
  await resetDb();
  fixtures({ ...TMDB });
  await addUser('owner');
  await addUser('cy');
});
after(() => pool.end());

describe('offering imports', () => {
  test('a new account is offered them until it chooses; starting fresh ends the offer', async () => {
    const me = await signIn('cy');
    const r = await me.get('/api/import');
    assert.equal(r.json.onboard, true);
    // each from its own export file, but Kitsu: read by username
    assert.deepEqual(r.json.sources.map((s: { id: string; file: string | null }) => [s.id, !!s.file]),
      [['trakt', true], ['simkl', true], ['letterboxd', true], ['mal', true], ['anilist', true], ['kitsu', false]]);
    await me.post('/api/import/fresh');
    assert.equal((await me.get('/api/import')).json.onboard, false);
  });
});

describe('Letterboxd', () => {
  test('an uploaded export: diary viewings, a watched film without a date, the rating and the watchlist', async () => {
    fixtures({ ...TMDB });
    const eve = await addUser('eve');
    const me = await signIn('eve');
    const up = await me.post('/api/import/file/letterboxd', { data: zip(LETTERBOXD).toString('base64') });
    assert.deepEqual([up.status, up.json.entries], [200, 3]);
    assert.equal((await me.post('/api/import/file/letterboxd', { data: Buffer.from('nope').toString('base64') })).status, 400);
    await runNextImport();
    const run = await q.one<{ counts: Record<string, number> }>(`select counts from imports where user_id = ?`, eve);
    // the Matrix twice (diary), its rating, Dune saved; Crouching Tiger finds no match here
    assert.deepEqual([run!.counts.plays, run!.counts.ratings, run!.counts.watchlist, run!.counts.unmatched], [2, 1, 1, 1]);
    assert.deepEqual((await q.all<{ approx: number }>('select approx from history where user_id = ?', eve)).map((h) => h.approx), [2, 2]);
  });
});

describe('export files', () => {
  test('Trakt\'s export: history across its parts, ratings, the watchlist; a dateless watch is a date unknown', async () => {
    fixtures({ ...TMDB });
    const fay = await addUser('fay'), me = await signIn('fay');
    const up = await me.post('/api/import/file/trakt', { data: zip(TRAKT_EXPORT).toString('base64') });
    assert.deepEqual([up.status, up.json.entries], [200, 6]);
    await runNextImport();
    const run = await q.one<{ status: string; counts: Record<string, number> }>('select status, counts from imports where user_id = ?', fay);
    assert.deepEqual([run!.status, run!.counts.plays, run!.counts.ratings, run!.counts.watchlist], ['done', 3, 2, 1]);
    assert.deepEqual(await q.all('select key, approx from history where user_id = ? order by watched_at', fay),
      [{ key: 'tmdb:movie:693134', approx: 1 }, { key: 'tmdb:movie:603', approx: 0 }, { key: 'tmdb:tv:1399', approx: 0 }]);
    assert.equal((await me.post('/api/import/file/trakt', { data: zip({ 'other.txt': 'x' }).toString('base64') })).status, 400);
    // the same file again: nothing new
    await me.post('/api/import/file/trakt', { data: zip(TRAKT_EXPORT).toString('base64') });
    await runNextImport();
    assert.equal(await count('history', fay), 3);
    assert.equal(await count('ratings', fay), 2);
  });
  test('Simkl\'s backup: its JSON read as the API\'s items, wherever it keeps the lists', async () => {
    fixtures({ ...TMDB });
    const gus = await addUser('gus'), me = await signIn('gus');
    const backup = { user: { name: 'gus' }, lists: { movies: [{ status: 'completed', last_watched_at: '2024-02-01T20:00:00Z', movie: { ids: { tmdb: 603 } } }],
      shows: [{ status: 'plantowatch', show: { ids: { tmdb: 1399 } } }], anime: [] } };
    const up = await me.post('/api/import/file/simkl', { data: zip({ 'backup.json': JSON.stringify(backup) }).toString('base64') });
    assert.deepEqual([up.status, up.json.entries], [200, 2]);
    await runNextImport();
    const run = await q.one<{ counts: Record<string, number> }>('select counts from imports where user_id = ?', gus);
    assert.deepEqual([run!.counts.plays, run!.counts.watchlist], [1, 1]);
    assert.equal((await me.post('/api/import/file/simkl', { data: Buffer.from('{"hello":1}').toString('base64') })).status, 400);
  });
});
