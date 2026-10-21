// Files for the import tests.
import zlib from 'node:zlib';

// a zip of the given files, deflated (as Letterboxd's export is)
export function zip(files: Record<string, string>) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(text.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
export const LETTERBOXD = {
  'diary.csv': 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-05-02,The Matrix,1999,https://boxd.it/a,4.5,,,2024-05-01\n2024-06-02,The Matrix,1999,https://boxd.it/b,4.5,Yes,,2024-06-01\n',
  'watched.csv': 'Date,Name,Year,Letterboxd URI\n2024-05-02,The Matrix,1999,https://boxd.it/x\n2023-01-01,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/y\n',
  'ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2024-05-02,The Matrix,1999,https://boxd.it/x,4.5\n',
  'watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2024-07-01,Dune: Part Two,2024,https://boxd.it/z\n',
};
// Trakt's export: history in parts, ratings per kind, the watchlist (the same items as its API); one film marked watched
// without a date, which Trakt keeps on its release day at midnight
export const TRAKT_EXPORT = {
  'watched-history-1.json': JSON.stringify([
    { watched_at: '2024-05-01T20:00:00.000Z', type: 'movie', movie: { title: 'The Matrix', year: 1999, ids: { tmdb: 603 } } },
    { watched_at: '2024-05-03T21:00:00.000Z', type: 'episode', show: { ids: { tmdb: 1399 } }, episode: { season: 1, number: 1 } }]),
  'watched-history-2.json': JSON.stringify([
    { watched_at: '2024-02-27T00:00:00.000Z', type: 'movie', movie: { title: 'Dune: Part Two', year: 2024, ids: { tmdb: 693134 } } }]),
  'ratings-movies.json': JSON.stringify([{ rated_at: '2024-05-02T10:00:00.000Z', rating: 10, movie: { ids: { tmdb: 603 } } }]),
  'ratings-episodes.json': JSON.stringify([{ rated_at: '2024-05-04T10:00:00.000Z', rating: 8, show: { ids: { tmdb: 1399 } }, episode: { season: 1, number: 1 } }]),
  'lists-watchlist.json': JSON.stringify([{ listed_at: '2024-01-01T00:00:00.000Z', type: 'show', show: { ids: { tmdb: 1399 } } }]),
};
