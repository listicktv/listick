// The lists the public API hands out (/api/v1/lists, the Stremio Catalogs addon's catalogs): every list the page shows, as plain title lists per Stremio type, with their filters.
import { lastEpOf, nextEpFrom, nextUpFrom } from './cards';
import { q } from './db';
import { forYouOf } from './foryou';
import { tvSeasons, tvSeasonsCache } from './mapping';
import { ROWS, SERVICES, SERVICE_ROWS, ServiceRows, listOf, rowType, rowsNow } from './rows';
import { listKeys, stremioLists } from './lists';
import { inParallel } from './poller';
import { tmdb } from './sources';
import { liveOf } from './store';
import { GENRE_OPTIONS, genresOf, titlesOf } from './titles';
import type { Title } from './types';
import { HOUR } from './util';

// for the catalogs addon (catalogs/): every list the page shows, as plain title lists. A list is a source id: plan (Plan to
// watch), upnext (shows watched in the last `days` days whose next episode is out), foryou.suggested / foryou.coming,
// row.<row id>, and svc.<row id> (the streaming services' rows: the filter picks the service, none means all of them).
// Stremio wants one type per catalog: movie, series or anime (anime films and shows together, kept out of the other two),
// so a list is offered once per type it can hold, and filters by genre. Your own lists and For you are the exception: one
// mixed catalog per list under their own type ("For You", a Discover category of its own) whose filter picks movies, shows
// or anime
const stremioType = (t: Title) => (t.anime === 1 || t.type === 'anime' ? 'anime' : t.type === 'movie' ? 'movie' : 'series');
// what Stremio opens an item as: a film or a show (an anime film in a movie row is a Kitsu entry, which reads as a show)
const itemKind = (t: Title, src: string) => ((/^row\.anime-movie/.test(src) || t.type === 'movie') ? 'movie' : 'series');
type ListItem = { key: string; next?: string | null };
async function upNextKeys(uid: string, days: number) {
  const out: ListItem[] = [];
  const shows = await q.all<{ key: string; at: number }>(`select h.key, max(h.watched_at) at from history h join titles t using (key)
    where h.user_id = ? and t.type != 'movie' and h.season > 0 and h.watched_at > ? group by h.key order by at desc`, uid, Date.now() - days * 24 * HOUR);
  const ts = await titlesOf(shows.map((r) => r.key));
  for (const r of shows) {
    const t = ts.get(r.key), id = Number(/^tmdb:tv:(\d+)$/.exec(r.key)?.[1]) || null;
    if (!t) continue;
    if (id) await tvSeasons(id).catch(() => {});
    const last = await lastEpOf(uid, t.key), n = nextEpFrom(t, last), aired = id && tvSeasonsCache.get(id)?.aired;
    if (!n || (id && (!aired || n.se > aired.se || (n.se === aired.se && n.ep > aired.ep))) || (!id && t.episodes && n.ep > t.episodes)) continue;
    out.push({ key: t.key, next: nextUpFrom(t, last) });
  }
  return out;
}
// the streaming services' row, one service (by name) or all of them taken in turn without repeats
function serviceKeys(serviceRows: ServiceRows, row: string, service: string | null): ListItem[] {
  const one = SERVICES.find((sv) => sv.name === service);
  if (one) return (serviceRows[one.id]?.[row] || []).map((key) => ({ key }));
  const lists = SERVICES.map((sv) => serviceRows[sv.id]?.[row] || []), seen = new Set<string>(), out: ListItem[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i] && !seen.has(l[i])) { seen.add(l[i]); out.push({ key: l[i] }); }
  return out;
}
// uid: whose lists (Plan to watch, Up next, For you); the rows are everyone's
async function sourceKeys(src: string, days: number, filter: string | null, uid: string): Promise<ListItem[] | null> {
  if (src === 'plan') return q.all<ListItem>('select key from watchlist where user_id = ? order by added_at desc', uid);
  if (src === 'upnext') return upNextKeys(uid, days);
  if (src === 'foryou.suggested') return (await forYouOf(uid))?.suggested || [];
  if (src.startsWith('list.')) return ((await listKeys(uid, src.slice(5))) || []).map((key) => ({ key }));
  if (src === 'foryou.coming') return ((await liveOf(uid)).forYou?.coming || []).map((x) => ({ key: x.key, next: x.what }));
  const [kind, a] = src.split('.'), R = await rowsNow();
  if (kind === 'row') return listOf(R.rows, a).map((key) => ({ key }));
  if (kind === 'svc') return serviceKeys(R.services, a, filter);
  return null;
}
type Filter = { name: string; options: string[] };
type CatalogSource = { src: string; type: string; name: string; group: string; filter: Filter; genres?: string[]; years?: string[]; ratings?: string[] };
// uid: whose lists join Your lists
export async function catalogSources(uid?: string) {
  const { rows } = await rowsNow();
  const out: CatalogSource[] = [];
  const offer = (src: string, name: string, group: string, types: string[], filter?: Filter) => { for (const type of types) out.push({ src, type, name, group, filter: filter || { name: 'Genre', options: GENRE_OPTIONS[type] } }); };
  const kinds = { name: 'Type', options: Object.keys(FOR_YOU_KINDS) };
  offer('plan', 'Plan to watch', 'Your lists', [FOR_YOU], kinds);
  offer('upnext', 'Up next', 'Your lists', [FOR_YOU], { name: 'Type', options: ['Anime', 'Series'] });
  if (uid) for (const l of await stremioLists(uid)) offer(`list.${l.id}`, l.name, 'Your lists', [FOR_YOU], kinds);
  // For you fills a while after a start, so it's always offered (an empty catalog until then)
  offer('foryou.suggested', 'Suggested', 'For you', [FOR_YOU], kinds);
  offer('foryou.coming', 'Coming soon', 'For you', [FOR_YOU], kinds);
  // the rows are plain lists (no filter); besides, all but the kids rows can be seen by genre, by year and by rating
  // (the addon makes an extra catalog of each the user ticks)
  for (const r of ROWS) if (listOf(rows, r.id).length) offer(`row.${r.id}`, r.title, 'Discover', [rowType(r.id)], { name: 'None', options: [] });
  for (const x of out) if (x.src.startsWith('row.') && !x.src.startsWith('row.kids-'))
    Object.assign(x, { genres: GENRE_OPTIONS[x.type], years: YEAR_OPTIONS(), ratings: RATING_OPTIONS });
  for (const r of SERVICE_ROWS) offer(`svc.${r.id}`, `Streaming ${r.title.toLowerCase()}`, 'Streaming', [rowType(r.id)], { name: 'Service', options: SERVICES.map((sv) => sv.name) });
  return out;
}
export const FOR_YOU = 'For You';
const FOR_YOU_KINDS: Record<string, string> = { Anime: 'anime', Movies: 'movie', Series: 'series' };   // the filter's order
// the year part of a filter: this year and the five before, then decades, then everything older
function YEAR_OPTIONS() {
  const y = new Date().getFullYear();
  return [...Array.from({ length: 6 }, (_, i) => String(y - i)), '2010s', '2000s', '1990s', 'Older'];
}
const RATING_OPTIONS = ['8+', '7+', '6+', 'Under 6'];
// a title against one filter choice: a year, a decade, Older (before 1990), a score (8+, Under 6) or a genre; none: everything
function pickOk(t: Title, f: string | null) {
  if (!f) return true;
  if (/^\d\+$/.test(f)) return t.rating != null && t.rating >= Number(f[0]);
  if (f === 'Under 6') return t.rating != null && t.rating < 6;
  if (/^\d{4}$/.test(f)) return t.year === Number(f);
  if (/^\d{4}s$/.test(f)) return t.year != null && t.year >= Number(f.slice(0, 4)) && t.year < Number(f.slice(0, 4)) + 10;
  if (f === 'Older') return !!t.year && t.year < 1990;
  return genresOf(t).includes(f);
}
// what Stremio opens each title as: its IMDb id (Cinemeta and stream addons know it), else a Kitsu entry's kitsu:<id> (the
// Kitsu addon), else tmdb:<id>. A TMDB title's IMDb id is asked of TMDB once and kept in titles.imdb ('' when it has none)
async function stremioIds(ts: Title[]) {
  const keys = ts.filter((t) => t.key.startsWith('tmdb:')).map((t) => t.key);
  const known = new Map((await q.all<{ key: string; imdb: string | null }>('select key, imdb from titles where key = any(?)', keys)).map((r) => [r.key, r.imdb]));
  await inParallel(keys.filter((k) => known.get(k) == null), 8, async (k) => {
    const [, kind, id] = k.split(':');
    const x = await tmdb<{ imdb_id?: string | null }>(`/${kind}/${id}/external_ids`).catch(() => null);
    if (!x) return;
    const imdb = /^tt\d+$/.test(x.imdb_id || '') ? x.imdb_id! : '';
    known.set(k, imdb);
    await q.run('update titles set imdb = ? where key = ?', imdb, k);
  });
  return (t: Title) => known.get(t.key) || `${t.key.startsWith('kitsu:') ? 'kitsu' : 'tmdb'}:${t.key.split(':')[2]}`;
}
export async function catalogList(src: string, type: string, days: number, filter: string | null, uid: string, genre: string | null = null) {
  const list = await sourceKeys(src, days, filter, uid);
  if (!list) return null;
  const ts = await titlesOf(list.map((x) => x.key)), items = list.map((x) => ({ x, t: ts.get(x.key) }));
  const withTitle = (i: { x: ListItem; t: Title | undefined }): i is { x: ListItem; t: Title } => !!i.t;
  const row = /^(row|svc)\./.test(src) && rowType(src.split('.').at(-1)!);
  // a split For you catalog: its kind (the filter) and, inside it, a genre; a row's filter is its genre; a streaming row's is
  // the service, and a split one (one catalog per service) asks a genre too
  const want = type === FOR_YOU && filter ? FOR_YOU_KINDS[filter] : undefined, g = type === FOR_YOU || src.startsWith('svc.') ? genre : filter;
  const keep = items.filter(withTitle).filter(({ t }) => (type === FOR_YOU ? !want || stremioType(t) === want : row ? row === type : stremioType(t) === type) && pickOk(t, g));
  const idOf = await stremioIds(keep.map(({ t }) => t));
  return keep.map(({ x, t }) => ({ id: idOf(t), key: t.key, type: itemKind(t, src), title: t.title, year: t.year, poster: t.poster, ...(x.next ? { next: x.next } : {}) }));
}
