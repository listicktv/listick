// Reading uploaded exports: zip, CSV, Letterboxd's files and MyAnimeList's XML.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe, test } from 'node:test';
import { csv, letterboxd, malXml, unzip } from '@/server/import/files';
import { LETTERBOXD, zip } from './fixtures';

describe('files', () => {
  test('unzip reads deflated entries by name', () => {
    const files = unzip(zip({ 'a.txt': 'hello', 'dir/b.csv': 'x,y\n1,2\n' }));
    assert.equal(files.get('a.txt')!.toString(), 'hello');
    assert.equal(files.get('dir/b.csv')!.toString(), 'x,y\n1,2\n');
    assert.throws(() => unzip(Buffer.from('not a zip at all, sorry')), /not a zip/);
  });
  test('csv handles quotes, doubled quotes, commas and line breaks in fields, and CRLF', () => {
    assert.deepEqual(csv('Name,Note\r\n"Crouching Tiger, Hidden Dragon","said ""wow""\ntwice"\r\nB,\r\n'),
      [{ Name: 'Crouching Tiger, Hidden Dragon', Note: 'said "wow"\ntwice' }, { Name: 'B', Note: '' }]);
  });
  test('letterboxd merges diary viewings, watched films, ratings (stars x2) and the watchlist', () => {
    const films = letterboxd(unzip(zip(LETTERBOXD)));
    const m = films.find((f) => f.name === 'The Matrix')!;
    assert.deepEqual(m.viewings, [{ date: '2024-05-01', rewatch: false }, { date: '2024-06-01', rewatch: true }]);
    assert.equal(m.rating, 9);
    assert.equal(films.find((f) => f.name === 'Crouching Tiger, Hidden Dragon')!.watched, true);
    assert.equal(films.find((f) => f.name === 'Dune: Part Two')!.want, '2024-07-01');
  });
  test('MyAnimeList XML, plain or gzipped, with CDATA titles and empty dates', () => {
    const xml = `<?xml version="1.0"?><myanimelist><anime><series_animedb_id>5114</series_animedb_id><series_title><![CDATA[Fullmetal Alchemist: Brotherhood]]></series_title>
      <series_episodes>64</series_episodes><my_watched_episodes>64</my_watched_episodes><my_start_date>2023-01-05</my_start_date><my_finish_date>2023-03-01</my_finish_date>
      <my_score>10</my_score><my_status>Completed</my_status></anime><anime><series_animedb_id>1</series_animedb_id><series_title>Cowboy Bebop</series_title>
      <my_watched_episodes>0</my_watched_episodes><my_start_date>0000-00-00</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_score>0</my_score>
      <my_status>Plan to Watch</my_status></anime></myanimelist>`;
    for (const buf of [Buffer.from(xml), zlib.gzipSync(xml)]) {
      const [fma, bebop] = malXml(buf);
      assert.deepEqual([fma.mal, fma.title, fma.watched, fma.score, fma.finished], [5114, 'Fullmetal Alchemist: Brotherhood', 64, 10, '2023-03-01']);
      assert.deepEqual([bebop.status, bebop.score, bebop.started], ['Plan to Watch', null, null]);
    }
    assert.throws(() => malXml(Buffer.from('<html></html>')), /not a MyAnimeList export/);
  });
});
