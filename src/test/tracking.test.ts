// Stremio's watched record and video ids: the parts of tracking that need no database.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe, test } from 'node:test';
import { decodeWatched, epOf, seriesOf } from '@/server/tracking';

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
  });
  test('the series of a video', () => {
    assert.equal(seriesOf('tt0903747:2:5'), 'tt0903747');
    assert.equal(seriesOf('kitsu:7442:12'), 'kitsu:7442');
  });
});
