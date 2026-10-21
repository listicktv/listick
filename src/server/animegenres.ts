// Anime's own genres (Isekai, Slice of Life, Psychological…) for TMDB-keyed anime, whose TMDB genres are few and loose: from
// MyAnimeList when it has a key, else Kitsu's categories (only those that are genres, not settings like "Japan" or "Present"),
// each anime reached by Fribb's links. Kept in titles.anime_genres, which saveTitles never writes, so a TMDB refresh keeps
// them; [] when neither source names a genre, so the title isn't asked again
import { q } from './db';
import { fribb, loadFribb } from './mapping';
import { kitsu, mal } from './sources';
import { MAL_GENRES } from './titles';
import { env } from './util';

// Kitsu's category names that are genres, beyond MyAnimeList's (which Kitsu mostly shares)
const KITSU: Record<string, string> = { ...MAL_GENRES, 'Science Fiction': 'Sci-Fi', Thriller: 'Thriller', 'School Life': 'School' };

async function genresFor(type: string, id: number): Promise<string[]> {
  const entries = type === 'tv' ? [...(fribb.byTmdb.get(id) || [])].sort((a, b) => (a.season || 99) - (b.season || 99) || a.offset - b.offset) : [];
  const k = type === 'tv' ? entries[0]?.kitsu : fribb.byMovie.get(id);
  const m = type === 'tv' ? entries.find((e) => e.mal)?.mal : k ? fribb.map.get(k)?.mal : null;
  if (m && env('MAL_CLIENT_ID')) {
    const d = await mal<{ genres?: { name: string }[] }>(`/anime/${m}?fields=genres`);
    return [...new Set((d.genres || []).map((g) => MAL_GENRES[g.name]).filter(Boolean))];
  }
  if (!k) return [];
  const d = await kitsu<{ data: { attributes: { title: string } }[] }>(`/anime/${k}/categories?page[limit]=20`);
  return [...new Set(d.data.map((c) => KITSU[c.attributes.title]).filter(Boolean))];
}
// the worker: anime titles still without them, newest first, 150 a run
export async function fillAnimeGenres() {
  const rows = await q.all<{ key: string }>(`select key from titles where anime = 1 and anime_genres is null and key ~ '^tmdb:(movie|tv):[0-9]+$'
    order by fetched_at desc limit 150`);
  if (!rows.length) return;
  await loadFribb();
  let found = 0;
  for (const { key } of rows) {
    const [, type, id] = key.split(':');
    try {
      const g = await genresFor(type, Number(id));
      await q.run('update titles set anime_genres = ?::jsonb where key = ?', JSON.stringify(g), key);
      if (g.length) found++;
    } catch (e) { console.error(`anime genres ${key}: ${e}`); }
  }
  console.log(`anime genres: ${rows.length} anime checked, ${found} with their own genres`);
}
