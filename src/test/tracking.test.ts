// Stremio's watched record and video ids: the parts of tracking that need no database.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe, test } from 'node:test';
import { fetchAddon, isPrivate, servesMeta, stremioOrder, type Addon } from '@/server/live';
import { decodeWatched, epOf, knownVideo, played, seriesOf, stillOpen } from '@/server/tracking';

// a watched record as Stremio writes it: "<anchor video>:<videos up to it>:<base64 zlib bitmap>", bit i = the i-th video
const record = (anchor: string, watched: boolean[]) => {
  const bits = Buffer.alloc(Math.ceil(watched.length / 8));
  watched.forEach((w, i) => { if (w) bits[i >> 3] |= 1 << (i & 7); });
  return `${anchor}:${watched.length}:${zlib.deflateSync(bits).toString('base64')}`;
};
const vids = ['tt1:1:1', 'tt1:1:2', 'tt1:1:3', 'tt1:2:1', 'tt1:2:2'].map((id) => ({ id, tvdb: null }));

describe('decodeWatched', () => {
  test('reads which videos are ticked, counted back from the anchor', () => {
    assert.deepEqual(decodeWatched(record('tt1:2:1', [true, false, true, true]), vids), ['tt1:1:1', 'tt1:1:3', 'tt1:2:1']);
  });
  test('an anchor that is not in the list, or a broken bitmap, reads as nothing', () => {
    assert.deepEqual(decodeWatched(record('tt1:9:9', [true]), vids), []);
    assert.deepEqual(decodeWatched('tt1:1:2:2:not-zlib', vids), []);
    assert.deepEqual(decodeWatched(null, vids), []);
  });
});

describe('video ids', () => {
  test('IMDb episodes keep their season; Kitsu episodes go under season 1', () => {
    assert.deepEqual(epOf('tt0903747:2:5'), [2, 5]);
    assert.deepEqual(epOf('kitsu:7442:12'), [1, 12]);
    assert.deepEqual(epOf('tt0133093'), [-1, -1]);
    assert.deepEqual(epOf('tmdb:79063:2:1'), [2, 1]);
    assert.deepEqual(epOf('tvdb:81189:3:7'), [3, 7]);
    assert.deepEqual(epOf('mal:52991:5'), [1, 5]);
  });
  test('the series of a video', () => {
    assert.equal(seriesOf('tt0903747:2:5'), 'tt0903747');
    assert.equal(seriesOf('kitsu:7442:12'), 'kitsu:7442');
    assert.equal(seriesOf('tmdb:79063:2:1'), 'tmdb:79063');
    assert.equal(seriesOf('mal:52991:5'), 'mal:52991');
    assert.equal(seriesOf('tvdb:81189:3:7'), 'tvdb:81189');
  });
});

describe('Stremio progress', () => {
  const MIN = 60000;
  test('open while its position is past the start; Stremio sets it back to 0 or 1 at the end', () => {
    assert.equal(stillOpen({ video: 'tt1:1:3', offset: 20 * MIN }), true, 'stopped part-way, any day');
    assert.equal(stillOpen({ video: 'tt1:1:4', offset: 1 }), false, 'ended, moved on to the next episode');
    assert.equal(stillOpen({ video: 'tt1:1:3', offset: 0 }), false, 'ended, no next episode');
    assert.equal(stillOpen({ video: null, offset: 0 }), false, 'nothing open');
  });
  test('played: over 70 % of it, the time adding up across sessions', () => {
    assert.equal(played({ watched: 37 * MIN, duration: 52 * MIN }), true);
    assert.equal(played({ watched: 10 * MIN, duration: 52 * MIN }), false, 'seeking ahead adds no time played');
    assert.equal(played({ watched: 0, duration: 0 }), false);
  });
});

describe('knownVideo', () => {
  const lookup = async (src: string, n: string, movie: boolean) =>
    ({ mal: 'kitsu:9', anilist: 'kitsu:8', tvdb: movie ? 'tmdb:7' : 'tmdb:6', kitsu: 'tmdb:5' } as Record<string, string>)[src + (n === '0' ? 'x' : '')] ?? null;
  test('swaps the leading addon id, keeps the rest', async () => {
    assert.equal(await knownVideo('mal:123:5', false, lookup), 'kitsu:9:5');
    assert.equal(await knownVideo('anilist:1:2', false, lookup), 'kitsu:8:2');
    assert.equal(await knownVideo('tvdb:81189:3:7:4:eJwDAAAAAAE=', false, lookup), 'tmdb:6:3:7:4:eJwDAAAAAAE=');
    assert.equal(await knownVideo('tvdb:1', true, lookup), 'tmdb:7');
    assert.equal(await knownVideo('kitsu:12', true, lookup), 'tmdb:5');
  });
  test('leaves known ids alone', async () => {
    for (const s of ['tt0903747:3:7', 'tmdb:1396:1:1', 'kitsu:12:3', null]) assert.equal(await knownVideo(s, false, lookup), s);
    assert.equal(await knownVideo('tt0111161', true, lookup), 'tt0111161');
  });
  test('null when there is no mapping', async () => {
    assert.equal(await knownVideo('mal:0:5', false, lookup), null);
  });
});

describe('user addons', () => {
  const addon = (manifest: Addon['manifest']): Addon => ({ transportUrl: 'https://x.example/manifest.json', manifest });
  test('meta served as stremio-core matches it', () => {
    const short = addon({ types: ['series'], idPrefixes: ['tt', 'mal:'], resources: ['catalog', 'meta'] });
    assert.ok(servesMeta(short, 'series', 'mal:1'));
    assert.ok(!servesMeta(short, 'movie', 'tt1'));
    assert.ok(!servesMeta(short, 'series', 'kitsu:1'));
    // a full resource uses only its own types and prefixes; none means every id
    const full = addon({ types: ['movie'], idPrefixes: ['tt'], resources: [{ name: 'meta', types: ['series'] }] });
    assert.ok(servesMeta(full, 'series', 'tvdb:1'));
    assert.ok(!servesMeta(full, 'movie', 'tt1'));
    assert.ok(!servesMeta(addon({ types: ['series'], resources: ['stream'] }), 'series', 'tt1'));
  });
  test('videos in the order Stremio builds the watched record from', () => {
    const order = stremioOrder([
      { id: 'b', season: 1, episode: 2 }, { id: 'sp', season: 0, episode: 1 }, { id: 'a', season: 1, episode: 1 },
      { id: 'late', season: 1, episode: 1, released: '2020-02-01' }, { id: 'none' },
    ]).map((v) => v.id);
    assert.deepEqual(order, ['none', 'sp', 'a', 'late', 'b']);
  });
  test('only public https addons are fetched', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.4', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(isPrivate(ip), ip);
    for (const ip of ['1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivate(ip), ip);
    assert.equal(await fetchAddon('http://example.com/manifest.json'), null);
    assert.equal(await fetchAddon('https://127.0.0.1/manifest.json'), null);
    assert.equal(await fetchAddon('https://[::1]/manifest.json'), null);
    assert.equal(await fetchAddon('https://localhost/manifest.json'), null);
  });
});
