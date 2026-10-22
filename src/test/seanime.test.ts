// Seanime routes: plays by AniList id, watching now, anime as AniList entries.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { pool } from '@/db';
import { q } from '@/server/db';
import { addTitles, addUser, api, fixtures, resetDb, signIn, title } from './helpers';

const AOT = 'tmdb:tv:1429', SOLO = 'kitsu:anime:300', FILM = 'tmdb:movie:500', LATER = 'tmdb:tv:7000';
const FRIBB = [
  { kitsu_id: 99, anilist_id: 999, type: 'TV', themoviedb_id: { tv: 1429 }, season: { tmdb: 3 }, episode_offset: { tmdb: 0 } },
  { kitsu_id: 100, anilist_id: 1000, type: 'TV', themoviedb_id: { tv: 1429 }, season: { tmdb: 3 }, episode_offset: { tmdb: 12 } },
  { kitsu_id: 200, anilist_id: 2000, type: 'MOVIE', themoviedb_id: { movie: 500 } },
  { kitsu_id: 300, anilist_id: 3000, type: 'TV' },
  { kitsu_id: 700, anilist_id: 7001, type: 'TV', themoviedb_id: { tv: 7000 }, season: { tmdb: 1 }, episode_offset: { tmdb: 0 } },
];
let me: Awaited<ReturnType<typeof signIn>>, key = '';

before(async () => {
  await resetDb();
  fixtures({
    'anime-list-full.json': FRIBB,
    '/3/tv/1429': { id: 1429, seasons: [{ season_number: 3, episode_count: 22 }], last_episode_to_air: { season_number: 3, episode_number: 22 } },
  });
  await addUser('sena');
  const art = { poster: '/p.jpg', anime: 1 };
  await addTitles(title(AOT, { title: 'Attack on Titan', ...art }), title(SOLO, { title: 'Solo', episodes: 12, ...art }),
    title(FILM, { title: 'A Film', ...art }), title(LATER, { title: 'Later', ...art }), title('tmdb:movie:603', { title: 'The Matrix' }),
    title('kitsu:anime:100', { title: 'AoT S3 Part 2', ...art }), title('kitsu:anime:200', { title: 'A Film (Kitsu)', ...art }));
  me = await signIn('sena', 'password-123', '198.51.100.60');
  key = (await me.post('/api/account/apikey/seanime')).json.apiKeys.find((k: { id: string }) => k.id === 'seanime').key;
});
after(() => pool.end());

const play = (body: Record<string, unknown>, k = key) => api('/api/v1/anime/play', { method: 'POST', body, headers: { authorization: `Bearer ${k}` } });

describe('Seanime', () => {
  test('a watched episode by AniList id becomes a play on its TMDB or Kitsu title', async () => {
    assert.equal((await play({ anilistId: 1000, episode: 3, state: 'watched' })).json.recorded, 1, 'a part of a TMDB season');
    assert.equal((await play({ anilistId: 3000, episode: 2, state: 'watched' })).json.recorded, 1, 'a Kitsu entry TMDB lacks');
    assert.equal((await play({ anilistId: 2000, episode: 1, state: 'watched' })).json.recorded, 1, 'a film');
    assert.equal((await play({ anilistId: 1000, episode: 3, state: 'watched' })).json.recorded, 0, 'the same play again is not added');
    assert.equal((await play({ anilistId: 4242, episode: 1, state: 'watched' })).status, 404);
    assert.equal((await play({ anilistId: 1000, episode: 0, state: 'watched' })).status, 400);
    assert.equal((await play({ anilistId: 1000, episode: 9999, state: 'watched' })).status, 400);
    const plays = await q.all<{ key: string; season: number; episode: number; source: string }>('select key, season, episode, source from history order by key');
    assert.deepEqual(plays, [{ key: SOLO, season: 1, episode: 2, source: 'seanime' }, { key: FILM, season: -1, episode: -1, source: 'seanime' },
      { key: AOT, season: 3, episode: 15, source: 'seanime' }]);
    assert.match((await me.get('/api/account')).json.seanime.last.name, /^A Film/, 'the last play shows in Settings');
  });
  test('playing shows as watching now until stopped', async () => {
    const now = async () => (await q.one<{ state: { key: string; ep: number; pct: number } | null }>(`select state from sync_state where source = 'seanime' and item = 'now'`))?.state ?? null;
    assert.equal((await play({ anilistId: 1000, episode: 4, state: 'playing', progress: 40 })).json.playing, true);
    assert.deepEqual([(await now())?.key, (await now())?.ep, (await now())?.pct], [AOT, 16, 40]);
    await play({ anilistId: 1000, episode: 4, state: 'stopped' });
    assert.equal(await now(), null);
  });
  test('your anime as AniList entries: Up next, Plan to watch and lists', async () => {
    await me.post(`/api/watchlist/add/${encodeURIComponent(LATER)}`);
    await me.post('/api/watchlist/add/tmdb%3Amovie%3A603');
    await me.post('/api/lists/new', { name: 'Favourites', add: SOLO });
    await me.post('/api/lists/new', { name: 'Films', add: 'tmdb:movie:603' });
    await addUser('kai');
    const kai = await signIn('kai', 'password-123', '198.51.100.61');
    const shared = (await kai.post('/api/lists/new', { name: 'Kai picks', shared: true, add: LATER })).json.id;
    await me.post(`/api/lists/${shared}/follow`, { on: true });
    await q.run(`insert into meta (k, v) values ('rows', ?::jsonb) on conflict (k) do update set v = excluded.v`, JSON.stringify({ rows: { at: Date.now(), 'anime-trending': [SOLO, LATER] } }));
    const r = await api('/api/v1/anime', { headers: { authorization: `Bearer ${key}` } });
    assert.equal(r.status, 200);
    const ids = (xs: { anilistId: number; episode?: number }[]) => xs.map((x) => [x.anilistId, x.episode ?? null]);
    assert.deepEqual(ids(r.json.upNext).sort(), [[1000, 4], [3000, 3]], 'the next episode in its AniList entry');
    assert.deepEqual(ids(r.json.plan), [[7001, null]], 'anime only');
    const groups = (gs: { name: string; owner?: string; items: { anilistId: number }[] }[]) => gs.map((l) => [l.name, l.owner ?? null, l.items.map((x) => x.anilistId)]);
    assert.deepEqual(groups(r.json.lists), [['Favourites', null, [3000]], ['Kai picks', 'kai', [7001]], ['Watched', null, [2000, 3000, 999]]],
      'yours, followed, then the built-in ones; anime only');
    assert.deepEqual(groups(r.json.discover), [['Trending anime', null, [3000, 7001]]], 'the anime rows');
  });
  test('keys open only their scopes', async () => {
    assert.equal((await play({ anilistId: 1000, episode: 5, state: 'watched' }, 'not-a-real-seanime-key')).status, 401);
    const cal = (await me.post('/api/account/apikey/calendar')).json.apiKeys.find((k: { id: string }) => k.id === 'calendar').key;
    assert.equal((await play({ anilistId: 1000, episode: 5, state: 'watched' }, cal)).status, 403);
    const jf = (await me.post('/api/account/apikey/jellyfin')).json.apiKeys.find((k: { id: string }) => k.id === 'jellyfin').key;
    assert.equal((await api('/api/v1/anime', { headers: { authorization: `Bearer ${jf}` } })).status, 403);
  });
});
