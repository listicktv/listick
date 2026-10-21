// For you: suggestions from what you watched, and what's coming soon.
import { viewsOf } from './cards';
import { q } from './db';
import { details } from './details';
import { fromMal, resolve } from './mapping';
import { mal, tmdb } from './sources';
import { liveOf, watchKeys } from './store';
import { cleanTitle, fromTmdb, getTitle, saveTitles, titlesOf } from './titles';
import type { Card, ForYou, MalAnime, TmdbCollection, TmdbPage } from './types';
import { HOUR, env, present } from './util';

// ---------- for you: rows built from what you watched (IMDb ids from Stremio's history, MAL ids of the anime you played) ----------
// Because you watched (TMDB recommendations of the 2 most recent watches), Coming soon (next episodes and premieres of
// shows you watched or saved, watchlist films not out yet) and Next in the series (the next film of a collection).
// Kept 6 h per set of watches; watchlist flags are fresh on every answer.
type Suggestion = { key: string; note?: string | null; date?: string | null; what?: string | null };
type ForYouParts = { recs: Record<'movie' | 'tv' | 'anime', Suggestion[]>; coming: Suggestion[]; next: Suggestion[] };
const forYouCache = new Map<string, { at: number; value: ForYouParts }>();
// a suggestion you dismissed (the poster's ✕) stays out of Suggested for good
const dismissedOf = async (uid: string) => new Set((await q.all<{ item: string }>("select item from sync_state where user_id = ? and source = 'fy-hide'", uid)).map((r) => r.item));
export async function forYouOf(uid: string): Promise<ForYou | null> {
  const f = (await liveOf(uid)).forYou;
  if (!f) return f;
  const gone = await dismissedOf(uid);
  return { ...f, suggested: (f.suggested || []).filter((t) => !gone.has(t.key)) };
}
export async function forYou(uid: string, imdbs: string[], mals: number[]): Promise<ForYou> {
  const ck = `${uid}|${imdbs.join(',')}|${mals.join(',')}`;
  let v = forYouCache.get(ck);
  if (!v || Date.now() - v.at > 6 * HOUR) { v = { at: Date.now(), value: await buildForYou(uid, imdbs, mals) }; forYouCache.set(ck, v); }
  const wl = await watchKeys(uid), gone = await dismissedOf(uid);
  const items = async (list: Suggestion[]) => {
    const ts = await titlesOf(list.map((x) => x.key)), views = await viewsOf(uid, list.map((x) => ts.get(x.key) || null), wl);
    return list.map((x, i): Card | null => views[i] && { ...views[i]!, note: x.note || null, date: x.date || null, what: x.what || null }).filter(present);
  };
  // movie · show · anime in turn (next-in-series films lead the movie side)
  const streams = [[...v.value.next, ...v.value.recs.movie], v.value.recs.tv, v.value.recs.anime];
  const mixed: Suggestion[] = [];
  for (let i = 0; i < 20; i++) for (const r of streams) if (r[i]) mixed.push(r[i]);
  const seen = new Set<string>();
  // nothing you have already watched (any play in your history), checked on every answer
  const suggested = (await items(mixed.filter((x) => !seen.has(x.key) && seen.add(x.key)))).filter((t) => !t.watched && !gone.has(t.key)).slice(0, 60);   // the page splits them into movies, shows and anime
  return { suggested, coming: await items(v.value.coming) };
}
async function buildForYou(uid: string, imdbs: string[], mals: number[]): Promise<ForYouParts> {
  const seeds: string[] = [];
  for (const id of imdbs) { const key = await resolve({ imdb: id }).catch(() => null); if (key && !seeds.includes(key)) seeds.push(key); }
  const seen = new Set(seeds);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10); // Coming soon looks 30 days ahead
  const fmt = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const played = async (keys: string[]) => new Set((await q.all<{ key: string }>('select distinct key from history where user_id = ? and key = any(?)', uid, keys)).map((r) => r.key));

  // recommendations from the last movie and the last show watched (TMDB), and the last anime (MyAnimeList)
  const recs: ForYouParts['recs'] = { movie: [], tv: [], anime: [] };
  // from your last few movies and shows (up to 3 each) until there are 10 unwatched picks of each kind
  for (const type of ['movie', 'tv'] as const) {
    for (const key of seeds.filter((k) => k.startsWith(`tmdb:${type}:`)).slice(0, 3)) {
      if (recs[type].length >= 10) break;
      const r = await tmdb<TmdbPage>(`/${type}/${key.split(':')[2]}/recommendations`).catch(() => null);
      const seed = (await getTitle(key))?.title || 'this';
      const cand = (r?.results || []).filter((x) => x.poster_path && (x.media_type || type) === type).map(fromTmdb(type));
      const had = await played(cand.map((t) => t.key));
      const fresh = cand.filter((t) => !seen.has(t.key) && !had.has(t.key) && !recs[type].some((y) => y.key === t.key));
      recs[type].push(...(await saveTitles(fresh.slice(0, 10 - recs[type].length))).map((t) => ({ key: t.key, note: `like ${seed}` })));
    }
  }
  if (env('MAL_CLIENT_ID')) {
    for (const id of mals) {
      const d = await mal<MalAnime>(`/anime/${id}?fields=title,alternative_titles,recommendations`).catch(() => null);
      const nodes = (d?.recommendations || []).filter((r) => !mals.includes(r.node.id)).slice(0, 20);
      if (nodes.length < 5) continue;
      const seed = d!.alternative_titles?.en || d!.title;
      recs.anime = (await saveTitles(await fromMal(nodes))).map((t) => ({ key: t.key, note: `like ${cleanTitle(seed).title}` })).slice(0, 20);
      break;
    }
  }

  const coming: Suggestion[] = [];
  const watchlisted = (await q.all<{ key: string }>("select key from watchlist where user_id = ? and key like 'tmdb:%'", uid)).map((r) => r.key);
  for (const key of [...new Set([...seeds.filter((k) => k.startsWith('tmdb:tv:')), ...watchlisted])]) {
    const d = await details(key).catch(() => null);
    if (!d) continue;
    if (d.type === 'tv' && d.next?.date && d.next.date >= today && d.next.date <= soon)
      coming.push({ key, date: d.next.date, what: d.next.ep === 1 ? `S${d.next.season} premiere` : `S${d.next.season} E${d.next.ep}` });
    if (d.type === 'movie' && d.released && d.released > today && d.released <= soon) coming.push({ key, date: d.released, what: 'Release' });
  }
  coming.sort((a, b) => a.date!.localeCompare(b.date!));

  const next: Suggestion[] = [], cols = new Set<number>();
  for (const key of seeds.filter((k) => k.startsWith('tmdb:movie:'))) {
    const d = await details(key).catch(() => null);
    if (!d?.collection || cols.has(d.collection.id)) continue;
    cols.add(d.collection.id);
    const c = await tmdb<TmdbCollection>(`/collection/${d.collection.id}`).catch(() => null);
    const parts = (c?.parts || []).filter((x) => x.release_date).sort((a, b) => a.release_date!.localeCompare(b.release_date!));
    const at = parts.findIndex((x) => `tmdb:movie:${x.id}` === key);
    const nx = parts.slice(at + 1).find((x) => !seen.has(`tmdb:movie:${x.id}`));
    if (nx) next.push({ key: (await saveTitles([fromTmdb('movie')(nx)]))[0].key, note: nx.release_date! > today ? `Out ${fmt(nx.release_date!)}` : `after ${d.title}` });
  }
  return { recs, coming, next };
}
