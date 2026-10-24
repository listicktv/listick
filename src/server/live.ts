// The live source for tracking and the page: Stremio's library (the worker polls it), per user by their Stremio key. A failed
// refresh keeps the last value.
import { STREMIO_LIVE } from '@/lib/cards';
import { fetchJSON } from './sources';
import { safe } from './util';
import type { CinemetaVideo, ContinueCard, StremioCard, StremioEp, StremioLive, StremioObserve } from './types';

const cache: Record<string, { at: number; value: unknown; failed: boolean }> = {};
export async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T | null> {
  const c = cache[key];
  if (c && Date.now() - c.at < (c.failed ? Math.min(ms, 30000) : ms)) return c.value as T | null;
  const value = await safe(fn);
  if (value == null && c?.value != null) { cache[key] = { at: Date.now(), value: c.value, failed: true }; return c.value as T; }
  cache[key] = { at: Date.now(), value, failed: value == null };
  return value;
}

// a title without its season suffix ("Black Clover Season 2" -> "Black Clover")
const noSeason = (t: string | null | undefined) => (t || '').replace(/[\s:]+(Season\s*\d+|\d+(st|nd|rd|th)\s+Season|S\d+)$/i, '');

// ---------- Stremio ----------
type LibraryItem = {
  _id: string; name?: string; type: string; poster?: string;
  state?: { lastWatched?: string; video_id?: string; timeWatched: number; timeOffset?: number; duration: number; flaggedWatched?: number | boolean; watched?: string };
};
type WatchState = NonNullable<LibraryItem['state']>;
type SeriesVid = { season: number; ep: number };
type SeriesMeta = Record<string, { anime: boolean; vids: SeriesVid[] }>;

// Stremio's watch history (the account's library, synced from every device). Not an official API: the call Stremio Web makes.
// Only full watches count (90 % of the runtime, or marked watched), so test clicks and half-watched episodes never show.
const FULL = 0.9;
const vidParts = (vid: string | null | undefined): [number | null, number | null] => {
  // video ids: tt<imdb>:season:ep, or kitsu:<id>:ep (anime numbered per season entry)
  const p = (vid || '').split(':');
  return p[0] === 'kitsu' ? [null, p[2] ? +p[2] : null] : p.length === 3 ? [+p[1], +p[2]] : [null, null];
};
const cleanName = (n: string | null | undefined) => (n || '').replace(/\s*\((?:19|20)\d{2}\)\s*$/, '');
const isFull = (st: WatchState) => !!st.flaggedWatched || (!!st.duration && st.timeWatched >= st.duration * FULL);
const watchedAt = (x: LibraryItem) => Date.parse(x.state!.lastWatched!);
// authKey: the user's Stremio session key; tag: who, so each library's episode lists are cached on their own
export async function stremio(authKey: string | null, tag: string): Promise<StremioLive | null> {
  if (!authKey) return null;
  const d = await fetchJSON<{ error?: { message?: string }; result?: LibraryItem[] }>('https://api.strem.io/api/datastoreGet', { method: 'POST', timeout: 8000, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authKey, collection: 'libraryItem', ids: [], all: true }) });
  if (d.error) throw new Error(`stremio: ${d.error.message || 'error'}`);
  const items = (d.result || []).filter((x) => x.state?.lastWatched && !/^mdblist/.test(x._id))
    .sort((a, b) => watchedAt(b) - watchedAt(a));
  const link = (x: LibraryItem) => `https://web.stremio.com/#/detail/${x.type}/${encodeURIComponent(x._id)}${x.type === 'series' && x.state!.video_id ? `/${encodeURIComponent(x.state!.video_id)}` : ''}`;
  const metas = await cached(`stremioMeta:${tag}`, 6 * 3600000, () => seriesMeta(items));
  // anime are counted from the first episode, as Kitsu does: Wind Breaker S2 E4 = 13 + 4 = E17
  const abs = <T extends StremioEp>(id: string, x: T): T => {
    const m = metas?.[id];
    if (!m?.anime || x.season == null || x.ep == null) return x;
    const season = x.season;
    return { ...x, title: x.title && noSeason(x.title), season: null, ep: m.vids.filter((v) => v.season < season).length + x.ep };
  };
  const history: StremioCard[] = items.filter((x) => isFull(x.state!)).slice(0, 20).map((x) => {
    const [season, ep] = vidParts(x.state!.video_id);
    return abs(x._id, { title: cleanName(x.name), type: x.type, season, ep, at: watchedAt(x), poster: x.poster || null, url: link(x), id: x._id });
  });
  const now = Date.now(), since = now - 60 * 86400000;
  // continue watching: a started episode or movie (2 min to 90 %), and one playing now; Up next comes from the History (upnext.ts)
  const cont: ContinueCard[] = [];
  for (const x of items.filter((i) => watchedAt(i) > since)) {
    const st = x.state!, [season, ep] = vidParts(st.video_id);
    const pct = st.duration ? Math.round((st.timeWatched / st.duration) * 100) : 0;
    const base = { title: cleanName(x.name), poster: x.poster || null, at: watchedAt(x), url: link(x), type: x.type, id: x._id };
    if (!isFull(st) && (st.timeWatched >= 120000 || now - watchedAt(x) < STREMIO_LIVE)) cont.push(abs(x._id, { ...base, video: st.video_id || null, season, ep, pct, resume: true }));
  }
  // watching now: an unfinished item saved in the last 4 minutes
  const cur = items.find((x) => !isFull(x.state!) && now - watchedAt(x) < STREMIO_LIVE);
  const nowPlaying = cur ? abs(cur._id, { title: cleanName(cur.name), type: cur.type, season: vidParts(cur.state!.video_id)[0], ep: vidParts(cur.state!.video_id)[1] }) : null;
  const watched7 = items.filter((x) => isFull(x.state!) && watchedAt(x) > now - 7 * 86400000).length;
  // for Listick's tracking: every title in the library, as Stremio has it now (movies of any age fill gaps;
  // series only within 30 days)
  const observe: StremioObserve[] = (d.result || []).filter((x) => x.state?.lastWatched && !/^mdblist/.test(x._id)).map((x) => ({ id: x._id, type: x.type,
    video: x.state!.video_id || null, watched: x.state!.timeWatched || 0, offset: x.state!.timeOffset || 0, duration: x.state!.duration || 0, at: watchedAt(x), full: isFull(x.state!),
    seen: x.state!.watched || null }));
  return { history, last: history[0] || null, continue: cont.slice(0, 15), now: nowPlaying, watched7, observe };
}
// the aired episodes (season, episode) of the IMDb-listed series watched in the last 60 days, from Cinemeta: anime are numbered
// from their first episode by them (Up next and the calendar come from the History, upnext.ts)
async function seriesMeta(items: LibraryItem[]): Promise<SeriesMeta> {
  const since = Date.now() - 60 * 86400000, out: SeriesMeta = {};
  const ids = [...new Set(items.filter((x) => x.type === 'series' && /^tt\d+$/.test(x._id) && watchedAt(x) > since).map((x) => x._id))].slice(0, 25);
  for (const id of ids) {
    type Meta = { videos?: CinemetaVideo[]; genres?: string[]; genre?: string[]; country?: string };
    const m = await safe(async () => (await fetchJSON<{ meta: Meta }>(`https://v3-cinemeta.strem.io/meta/series/${id}.json`, { timeout: 8000 })).meta);
    if (!m) continue;
    const vids = (m.videos || []).filter((v) => v.season > 0 && v.released).map((v) => ({ season: v.season, ep: (v.episode ?? v.number)! }));
    out[id] = { anime: (m.genres || m.genre || []).includes('Animation') && /Japan/.test(m.country || ''), vids };
  }
  return out;
}
