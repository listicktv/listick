// Stremio's watched record and video ids: the parts of tracking that need no database.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe, test } from 'node:test';
import { fetchAddon, isPrivate, servesMeta, stremioOrder, type Addon } from '@/server/live';
import { decodeWatched, epOf, knownVideo, played, seriesOf, stillOpen, tvdbOf } from '@/server/tracking';
import { nextSeason, swipeCloses, wheelSteps } from '@/ui/lib/title';

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

describe('wheelSteps', () => {
  const run = (events: [number, Partial<WheelEvent>][]) => {
    const out: number[] = [], h = wheelSteps((d) => out.push(d));
    let prevented = 0;
    for (const [at, e] of events) h({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, preventDefault: () => { prevented++; }, ...e }, at);
    return { out, prevented };
  };
  test('a long sideways gesture is one step', () => assert.deepEqual(run([[1000, { deltaX: 60 }], [1020, { deltaX: 80 }], [1040, { deltaX: 90 }]]).out, [1]));
  test("a trackpad's fading glide stays one step", () => assert.deepEqual(run([[1000, { deltaX: 70 }], [1100, { deltaX: 50 }], [1200, { deltaX: 35 }], [1300, { deltaX: 22 }], [1400, { deltaX: 12 }], [1500, { deltaX: 6 }]]).out, [1]));
  test('a new swipe during the glide steps again', () => assert.deepEqual(run([[1000, { deltaX: 70 }], [1100, { deltaX: 40 }], [1200, { deltaX: 20 }], [1300, { deltaX: 10 }], [1350, { deltaX: 60 }], [1370, { deltaX: 80 }], [1470, { deltaX: 30 }], [1570, { deltaX: 12 }], [1650, { deltaX: 70 }]]).out, [1, 1, 1]));
  test('a pause starts a new step', () => assert.deepEqual(run([[1000, { deltaX: 60 }], [1500, { deltaX: -60 }]]).out, [1, -1]));
  test('small movements add up', () => assert.deepEqual(run([[1000, { deltaX: 30 }], [1020, { deltaX: 30 }]]).out, [1]));
  test('Shift + wheel steps, in lines too', () => {
    assert.deepEqual(run([[1000, { deltaY: 100, shiftKey: true }]]).out, [1]);
    assert.deepEqual(run([[1000, { deltaY: -3, deltaMode: 1, shiftKey: true }]]).out, [-1]);
  });
  test('up and down is left to the page', () => assert.deepEqual(run([[1000, { deltaY: 120 }], [1020, { deltaX: 5, deltaY: 90 }]]), { out: [], prevented: 0 }));
});

describe('swipeCloses', () => {
  test('a long drag or a flick closes, a short slow one does not', () => {
    assert.equal(swipeCloses(200, 900, 600), true);
    assert.equal(swipeCloses(60, 80, 600), true);
    assert.equal(swipeCloses(60, 900, 600), false);
    assert.equal(swipeCloses(30, 20, 600), false);
  });
});

describe('nextSeason', () => {
  const s = (n: number, episodes: number | null = 10) => ({ n, name: '', episodes, year: null });
  const all = [s(0), s(1), s(2), s(3)];
  test('unwatched: the first season, not specials', () => assert.equal(nextSeason(all, {}), 1));
  test('part watched: that season', () => assert.equal(nextSeason(all, { 1: 10, 2: 4 }), 2));
  test('finished: the one after', () => assert.equal(nextSeason(all, { 1: 10 }), 2));
  test('last season finished: none', () => assert.equal(nextSeason(all, { 3: 10 }), null));
  test('unknown length stays on that season', () => assert.equal(nextSeason([s(1, null), s(2)], { 1: 3 }), 1));
  test('specials alone', () => assert.equal(nextSeason([s(0)], {}), 0));
});

describe('tvdbOf', () => {
  const addon = [{ id: 'tt1:4:6', tvdb: null }], cinemeta = async () => [{ id: 'tt1:4:6', tvdb: 99 }];
  test('Cinemeta fills the id only when the series has no match', async () => {
    assert.equal(await tvdbOf('tt1:4:6', addon, null, cinemeta), 99);
    assert.equal(await tvdbOf('tt1:4:6', addon, 'tmdb:tv:5', cinemeta), null);
  });
  test("the list's own id wins", async () => {
    assert.equal(await tvdbOf('tt1:4:6', [{ id: 'tt1:4:6', tvdb: 7 }], null, cinemeta), 7);
  });
  test('Cinemeta only for IMDb ids, and a failed fetch places nothing', async () => {
    assert.equal(await tvdbOf('tvdb:1:4:6', [], null, cinemeta), undefined);
    assert.equal(await tvdbOf('tt1:4:6', addon, null, async () => { throw new Error('down'); }), undefined);
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
