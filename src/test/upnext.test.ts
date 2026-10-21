// Up next and the Airing calendar from the History: the next aired episode of what you played lately, from any source; one
// still to air waits (it is in the calendar); a finished season goes on to the next; a show untouched for 60 days drops out.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { pool } from '@/db';
import { addPlay } from '@/server/plays';
import { followOf } from '@/server/upnext';
import { addTitles, addUser, fixtures, resetDb, title } from './helpers';

const DAY = 86400000;
const day = (d: number) => new Date(Date.now() + d * DAY).toLocaleDateString('sv-SE');
const eps = (...air: string[]) => ({ episodes: air.map((a, i) => ({ episode_number: i + 1, name: `E${i + 1}`, air_date: a })) });
let uid = '';

before(async () => {
  await resetDb();
  fixtures({
    // seasons first: a fixture answers every URL containing its key
    '/3/tv/100/season/1': eps(day(-30), day(-1)),            // E2 out yesterday
    '/3/tv/200/season/1': eps(day(-20), day(-10), day(2)),   // E3 airs in two days
    '/3/tv/300/season/1': eps(day(-60), day(-50)),
    '/3/tv/300/season/2': eps(day(-3)),                      // the next season is out
    '/3/tv/400/season/1': eps(day(-100), day(-90)),
    '/3/tv/300': { seasons: [{ season_number: 1, episode_count: 2 }, { season_number: 2, episode_count: 1 }] },
  });
  uid = await addUser('ann');
  await addTitles(title('tmdb:tv:100', { title: 'Aired' }), title('tmdb:tv:200', { title: 'Waits' }), title('tmdb:tv:300', { title: 'Next season' }),
    title('tmdb:tv:400', { title: 'Old' }));
  await addPlay(uid, 'tmdb:tv:100', 1, 1, Date.now() - 2 * DAY, 'manual');    // marked here
  await addPlay(uid, 'tmdb:tv:200', 1, 2, Date.now() - 3 * DAY, 'stremio');
  await addPlay(uid, 'tmdb:tv:300', 1, 2, Date.now() - 4 * DAY, 'trakt');     // an import
  await addPlay(uid, 'tmdb:tv:400', 1, 1, Date.now() - 90 * DAY, 'stremio');  // too long ago
});
after(() => pool.end());

describe('Up next from the History', () => {
  test('the next aired episode of each show played lately, newest first; one still to air waits', async () => {
    const f = await followOf(uid);
    assert.deepEqual(f.upNext.map((u) => [u.title, u.se, u.ep]), [['Aired', 1, 2], ['Next season', 2, 1]]);
  });
  test('the calendar has the episode still to air, and marks the ones you watched', async () => {
    const f = await followOf(uid);
    const waits = f.schedule.filter((e) => e.key === 'tmdb:tv:200').map((e) => [e.ep, e.watched]);
    assert.ok(waits.some(([ep, w]) => ep === 3 && !w));
    assert.ok(!f.schedule.some((e) => e.key === 'tmdb:tv:400'));
  });
});
