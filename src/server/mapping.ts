// Anime across sources: Fribb's mapping (Kitsu, MAL, IMDb, TheTVDB, TMDB), Kitsu entries placed on their TMDB show or film,
// and an IMDb id resolved to a Listick key.
import { getJSON, kitsu, tmdb } from './sources';
import { MAL_GENRES, cleanTitle, fillFromTmdb, fromKitsu, fromTmdb, genreJson, getTitle, saveTitles } from './titles';
import type { FribbEntry, KitsuOne, KitsuList, KitsuResource, KitsuTitle, MalNode, Place, Title, TmdbAt, TmdbDetails, TmdbFind } from './types';
import { HOUR, msg } from './util';

const malKitsu = new Map<number, KitsuResource | null>();   // MAL id -> Kitsu entry, for the life of the process
export async function fromMal(nodes: { node: MalNode }[]) {
  const out: KitsuTitle[] = [];
  // the Kitsu entries not looked up yet, all at once (one by one, a row took seconds)
  const todo = nodes.filter(({ node: n }) => !malKitsu.has(n.id));
  for (let i = 0; i < todo.length; i += 10) await Promise.all(todo.slice(i, i + 10).map(async ({ node: n }) => {
    const d = await kitsu<KitsuList>(`/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${n.id}&include=item`).catch(() => undefined);
    if (d === undefined) return;
    let k = (d?.included || []).find((x) => x.type === 'anime') || null;
    // brand-new entries often lack the MAL link on Kitsu yet: find it by title, if the start year agrees
    if (!k && n.start_season) {
      const r = await kitsu<KitsuList>(`/anime?filter[text]=${encodeURIComponent(n.alternative_titles?.en || n.title)}&page[limit]=3`).catch(() => null);
      k = (r?.data || []).find((x) => Number((x.attributes.startDate || '').slice(0, 4)) === n.start_season!.year) || null;
    }
    malKitsu.set(n.id, k);
  }));
  for (const { node: n } of nodes) {
    const k = malKitsu.get(n.id);
    if (!k) continue;   // not on Kitsu yet: no details to show, so it waits
    const t = fromKitsu(k);
    const en = n.alternative_titles?.en;
    if (en) { Object.assign(t, cleanTitle(en)); t.english = true; }
    t.poster = t.poster || n.main_picture?.large || n.main_picture?.medium || null;
    if (n.mean) { t.rating = n.mean; t.rating_src = 'mal'; }
    t.genres = genreJson((n.genres || []).map((g) => MAL_GENRES[g.name]).filter(Boolean));
    out.push(t);
  }
  return asTmdb(await fillFromTmdb(out));
}

// ---------- resolve: a Stremio (IMDb) id to our key, so any card can open the panel ----------
const resolved = new Map<string, string>();
export async function resolve({ imdb }: { imdb: string }) {
  if (resolved.has(imdb)) return resolved.get(imdb)!;
  let key: string | null = null;
  const d = await tmdb<TmdbFind>(`/find/${imdb}?external_source=imdb_id`);
  const m = d.movie_results?.[0], tv = d.tv_results?.[0];
  if (m) key = (await saveTitles([fromTmdb('movie')(m)]))[0].key;
  else if (tv) key = (await saveTitles([fromTmdb('tv')(tv)]))[0].key;
  if (key) resolved.set(imdb, key);
  return key;
}
// titles from Kitsu / MyAnimeList shown as their TMDB show or film where Fribb maps them (the rest stay Kitsu entries)
export async function asTmdb(list: Title[]) {
  const out: Title[] = [];
  for (const t of list) { const k = await canonKey(t.key); out.push(k === t.key ? t : (await getTitle(k)) ?? t); }
  return out;
}
// Fribb's anime-lists (the mapping AIOStreams uses), per Kitsu id: its IMDb ids and TheTVDB season, for anime Stremio opens by
// IMDb id, and where it sits on TMDB, so anime show like any series: Attack on Titan Season 3 Part 2 is TMDB show 1429,
// season 3 from episode 13; a film entry is the TMDB film. A show whose one TV entry has no season (One Piece) is counted from
// its first episode across TMDB's seasons. Fetched once a day per process; a failed fetch keeps the old map and is tried again in an hour.
type FribbKitsu = { imdb: string[]; season: number | null; tmdb: TmdbAt | null; mal: number | null };
type FribbOnTmdb = { kitsu: number; mal: number | null; season: number | null; offset: number };
type Fribb = {
  at: number; map: Map<number, FribbKitsu>; byImdb: Map<string, { kitsu: number; season: number | null }[]>; byTmdb: Map<number, FribbOnTmdb[]>;
  byMal: Map<number, number>;   // MyAnimeList id -> Kitsu id (the MAL and Simkl imports)
  byMovie: Map<number, number>;   // TMDB film id -> Kitsu id (the addon plays an anime film as its Kitsu entry)
};
export let fribb: Fribb = { at: 0, map: new Map(), byImdb: new Map(), byTmdb: new Map(), byMal: new Map(), byMovie: new Map() };
let fribbLoading: Promise<void> | null = null;
export async function loadFribb() {
  if (Date.now() - fribb.at <= 24 * HOUR) return;
  fribbLoading ||= (async () => {
    try {
      // and back: IMDb id -> its Kitsu entries, one per TheTVDB season; TMDB show -> its entries (for MyAnimeList's score)
      const map: Fribb['map'] = new Map(), byImdb: Fribb['byImdb'] = new Map(), byTmdb: Fribb['byTmdb'] = new Map(), byMal: Fribb['byMal'] = new Map(), byMovie: Fribb['byMovie'] = new Map(), whole = new Map<number, number>();
      for (const e of await getJSON<FribbEntry[]>('https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json')) {
        if (!e.kitsu_id) continue;
        if (e.mal_id && !byMal.has(e.mal_id)) byMal.set(e.mal_id, e.kitsu_id);
        // a film entry lists its TMDB films ([129]; it was one number), the first is the entry's own
        const films = ([] as number[]).concat(e.themoviedb_id?.movie ?? []);
        for (const f of films) if (!byMovie.has(f)) byMovie.set(f, e.kitsu_id);
        const tv = e.themoviedb_id?.tv, movie = films[0], se = e.season?.tmdb;
        const tmdbAt: TmdbAt | null = movie ? { type: 'movie', id: movie } : tv && Number.isInteger(se) ? { type: 'tv', id: tv, season: se, offset: e.episode_offset?.tmdb || 0 }
          : tv && e.type === 'TV' ? { type: 'tv', id: tv, abs: true } : null;
        if (tmdbAt?.abs) whole.set(tv!, (whole.get(tv!) || 0) + 1);
        const imdb = ([] as string[]).concat(e.imdb_id || []);
        map.set(e.kitsu_id, { imdb, season: e.season?.tvdb ?? null, tmdb: tmdbAt, mal: e.mal_id || null });
        for (const im of imdb) (byImdb.get(im) || byImdb.set(im, []).get(im)!).push({ kitsu: e.kitsu_id, season: e.season?.tvdb ?? null });
        if (tmdbAt?.type === 'tv') (byTmdb.get(tv!) || byTmdb.set(tv!, []).get(tv!)!).push({ kitsu: e.kitsu_id, mal: e.mal_id || null, season: tmdbAt.season ?? null, offset: tmdbAt.offset || 0 });
      }
      // two season-less TV entries on one show can't both count from its first episode: those stay on Kitsu
      for (const m of map.values()) if (m.tmdb?.abs && (whole.get(m.tmdb.id) ?? 0) > 1) m.tmdb = null;
      fribb = { at: Date.now(), map, byImdb, byTmdb, byMal, byMovie };
    } catch (err) {
      console.error(`fribb: ${msg(err)}`);
      fribb = { ...fribb, at: Date.now() - 23 * HOUR };
    }
  })().finally(() => { fribbLoading = null; });
  await fribbLoading;
}
async function imdbOfKitsu(id: string | number) {
  await loadFribb();
  return fribb.map.get(Number(id)) || null;
}
// the TMDB title a Kitsu entry maps to, saved so its key works anywhere (cards, history); fetched again after 30 days
export async function tmdbTitle(type: 'movie' | 'tv', id: number) {
  const key = `tmdb:${type}:${id}`, t = await getTitle(key);
  if (t?.poster && Date.now() - t.fetched_at < 30 * 24 * HOUR) return key;
  const d = await tmdb<TmdbDetails>(`/${type}/${id}`).catch(() => null);
  if (d) await saveTitles([fromTmdb(type)(d)]);
  return await getTitle(key) ? key : null;
}
async function tmdbPlace(key: string | null | undefined) {
  if (!key?.startsWith('kitsu:anime:')) return null;
  const m = (await imdbOfKitsu(key.split(':')[2]))?.tmdb;
  const k = m && await tmdbTitle(m.type, m.id);
  return k ? { ...m!, key: k } : null;
}
// a Kitsu key as its TMDB key (itself when Fribb has no TMDB place for it, or TMDB can't be reached)
export const canonKey = async (key: string) => (await tmdbPlace(key))?.key || key;
// a TMDB show's seasons (specials left out) and their episode counts, for entries counted from the first episode
type TvSeasons = { at: number; list: { n: number; count: number }[]; aired: { se: number; ep: number } | null };
export const tvSeasonsCache = new Map<number, TvSeasons>();
export async function tvSeasons(id: number) {
  const c = tvSeasonsCache.get(id);
  if (c && Date.now() - c.at < 24 * HOUR) return c.list;
  const d = await tmdb<TmdbDetails>(`/tv/${id}`).catch(() => null);
  if (!d) return c?.list || [];
  const list = (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0).sort((a, b) => a.season_number - b.season_number)
    .map((s) => ({ n: s.season_number, count: s.episode_count }));
  const la = d.last_episode_to_air;   // for Up next in the catalogs: only an episode that is out
  tvSeasonsCache.set(id, { at: Date.now(), list, aired: la ? { se: la.season_number, ep: la.episode_number } : null });
  return list;
}
// a Kitsu entry's episode (each entry counts from 1; anime plays sit under season 1) where it sits on TMDB; season -1 is the
// entry as a whole (a rating): its TMDB season, or the film / whole show
export async function canonEp(key: string, se: number, ep: number): Promise<Place> {
  const m = await tmdbPlace(key);
  if (!m) return { key, se, ep };
  if (m.type === 'movie' || (se < 0 && m.abs)) return { key: m.key, se: -1, ep: -1 };
  if (se < 0) return { key: m.key, se: m.season!, ep: -1 };
  if (!m.abs) return { key: m.key, se: m.season!, ep: m.offset! + ep };
  const seasons = await tvSeasons(m.id);
  if (!seasons.length) return { key, se, ep };
  let n = ep;
  for (const s of seasons) { if (n <= s.count) return { key: m.key, se: s.n, ep: n }; n -= s.count; }
  const last = seasons.at(-1)!;   // past what TMDB lists yet: on in its last season
  return { key: m.key, se: last.n, ep: last.count + n };
}
// a Kitsu entry saved as a title (once), so its key works in the history and lists
export async function kitsuTitle(id: number) {
  const key = `kitsu:anime:${id}`;
  if (await getTitle(key)) return key;
  const d = await kitsu<KitsuOne>(`/anime/${id}`).catch(() => null);
  if (!d?.data) return null;
  await saveTitles(await fillFromTmdb([fromKitsu(d.data)]));
  return key;
}
// a MyAnimeList id's Kitsu entry: Fribb's mapping, else Kitsu's own
export async function kitsuOfMal(mal: number) {
  await loadFribb();
  const k = fribb.byMal.get(mal);
  if (k) return k;
  const d = await kitsu<KitsuList>(`/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${mal}&include=item`).catch(() => null);
  const item = (d?.included || []).find((x) => x.type === 'anime');
  return item ? Number(item.id) : null;
}
