// AniList / MyAnimeList Sync: connect, sync only what the list lacks, with History dates, disconnect.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { pool } from '@/db';
import { WAIT } from '@/server/listsync';
import { addPlay } from '@/server/plays';
import { addTitles, addUser, bodies, fixtures, resetDb, signIn, title } from './helpers';

const AOT = 'tmdb:tv:1429', SOLO = 'kitsu:anime:300';
const FRIBB = [
  { kitsu_id: 99, anilist_id: 999, mal_id: 99, type: 'TV', themoviedb_id: { tv: 1429 }, season: { tmdb: 3 }, episode_offset: { tmdb: 0 } },
  { kitsu_id: 100, anilist_id: 1000, mal_id: 100, type: 'TV', themoviedb_id: { tv: 1429 }, season: { tmdb: 3 }, episode_offset: { tmdb: 12 } },
  { kitsu_id: 300, anilist_id: 3000, mal_id: 30, type: 'TV' },
];
const media = (id: number, idMal: number, episodes: number) => ({ id, idMal, episodes, title: { romaji: `A${id}` }, relations: { edges: [] } });
const saved: Record<string, unknown>[] = [];
const at = Date.now() - 86400000, H = 3600000;
const day = (ms: number) => new Date(ms).toLocaleDateString('sv-SE');
const fuzzy = (ms: number) => { const d = new Date(ms); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }; };
let me: Awaited<ReturnType<typeof signIn>>;

before(async () => {
  await resetDb();
  Object.assign(process.env, { ANILIST_CLIENT_ID: 'al-id', ANILIST_CLIENT_SECRET: 'al-secret', MAL_CLIENT_ID: 'mal-id', MAL_CLIENT_SECRET: 'mal-secret' });
  Object.assign(WAIT, { anilist: 0, mal: 0 });
  fixtures({
    'anime-list-full.json': FRIBB,
    'anilist.co/api/v2/oauth/token': { access_token: 'al-token', expires_in: 31536000 },
    'graphql.anilist.co': { data: {
      Viewer: { id: 5, name: 'ann-al' },
      Page: { media: [media(999, 99, 12), media(1000, 100, 10), media(3000, 30, 12)] },
      MediaListCollection: { lists: [{ entries: [{ mediaId: 3000, progress: 3, status: 'CURRENT' }, { mediaId: 999, progress: 5, status: 'CURRENT' }] }] },
      SaveMediaListEntry: { id: 1 },
    } },
    'myanimelist.net/v1/oauth2/token': { access_token: 'mal-token', refresh_token: 'mal-refresh', expires_in: 2678400 },
    'api.myanimelist.net/v2/users/@me/animelist': { data: [{ node: { id: 30 }, list_status: { num_episodes_watched: 1, status: 'watching' } },
      { node: { id: 99 }, list_status: { num_episodes_watched: 12, status: 'completed' } }] },
    'api.myanimelist.net/v2/users/@me': { name: 'ann-mal' },
    'my_list_status': {},
  });
  const answer = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('graphql.anilist.co') && String(init?.body).includes('SaveMediaListEntry')) saved.push(JSON.parse(String(init!.body)).variables);
    return answer(input, init);
  }) as typeof fetch;
  const uid = await addUser('ann');
  await addTitles(title(AOT, { title: 'Attack on Titan', anime: 1 }), title(SOLO, { title: 'Solo', anime: 1, episodes: 12 }));
  for (let ep = 1; ep <= 14; ep++) await addPlay(uid, AOT, 3, ep, at + ep * H, 'stremio');
  for (let ep = 1; ep <= 3; ep++) await addPlay(uid, SOLO, 1, ep, at + ep * H, 'seanime');
  me = await signIn('ann');
});
after(() => pool.end());

const connect = async (p: string) => {
  const to = new URL((await me.get(`/api/lists/connect/${p}`)).location!);
  const back = await me.get(`/api/lists/done/${p}?code=c0de&state=${to.searchParams.get('state')}`);
  assert.equal(back.location, '/settings/connections');
  return to;
};
const synced = async (p: 'anilist' | 'mal') => {
  await me.post(`/api/lists/sync/${p}`);
  for (let i = 0; i < 100; i++) {
    const s = (await me.get('/api/account')).json.lists[p];
    if (!s.running && s.last) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`${p} sync never finished`);
};

describe('AniList / MyAnimeList Sync', () => {
  test('both show in the account, not connected', async () => {
    const { lists } = (await me.get('/api/account')).json;
    assert.deepEqual(lists, { anilist: { user: null, expired: false, running: false, last: null }, mal: { user: null, expired: false, running: false, last: null } });
  });

  test('AniList: connects, then writes only what its list lacks', async () => {
    const to = await connect('anilist');
    assert.equal(to.host, 'anilist.co');
    const s = await synced('anilist');
    assert.equal(s.user, 'ann-al');
    assert.equal(s.last.wrote, 2);
    assert.deepEqual(saved.sort((a, b) => Number(a.id) - Number(b.id)), [
      { id: 999, p: 12, s: 'COMPLETED', sa: fuzzy(at + H), ca: fuzzy(at + 12 * H) },
      { id: 1000, p: 2, s: 'CURRENT', sa: fuzzy(at + 13 * H) },
    ], 'Solo already at 3 is left alone');
  });

  test('MyAnimeList: connects with PKCE, then writes only what its list lacks', async () => {
    const to = await connect('mal');
    assert.equal(to.searchParams.get('code_challenge_method'), 'plain');
    const s = await synced('mal');
    assert.equal(s.user, 'ann-mal');
    const writes = bodies.filter((b) => b.url.includes('my_list_status')).map((b) => [b.url.split('/anime/')[1].split('/')[0], b.body]).sort();
    assert.deepEqual(writes, [['100', { status: 'watching', num_watched_episodes: '2', start_date: day(at + 13 * H) }], ['30', { status: 'watching', num_watched_episodes: '3', start_date: day(at + H) }]],
      'a completed entry stays');
  });

  test('a done/ without its connect is refused', async () => {
    assert.equal((await me.get('/api/lists/done/anilist?code=x&state=nope')).status, 400);
  });

  test('disconnect forgets the account and the last sync', async () => {
    const { lists } = (await me.post('/api/lists/disconnect/mal')).json;
    assert.deepEqual(lists.mal, { user: null, expired: false, running: false, last: null });
    assert.equal(lists.anilist.user, 'ann-al');
  });
});
