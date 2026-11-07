// The live source for tracking and the page: Stremio's library (the worker polls it), per user by their Stremio key. A failed
// refresh keeps the last value.
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
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
  // video ids: tt<imdb>:season:ep, <source>:<id>:season:ep (tmdb:, tvdb:), or <source>:<id>:ep (kitsu:, mal:, anilist:; anime
  // numbered per season entry)
  const p = (vid || '').split(':');
  if (/^tt\d/.test(p[0])) return p.length === 3 ? [+p[1], +p[2]] : [null, null];
  return p.length === 4 ? [+p[2], +p[3]] : p.length === 3 ? [null, +p[2]] : [null, null];
};
const cleanName = (n: string | null | undefined) => (n || '').replace(/\s*\((?:19|20)\d{2}\)\s*$/, '');
const isFull = (st: WatchState) => !!st.flaggedWatched || (!!st.duration && st.timeWatched >= st.duration * FULL);
const watchedAt = (x: LibraryItem) => Date.parse(x.state!.lastWatched!);
// saved in the last 4 minutes, its position past 1
const isPlaying = (x: LibraryItem, now: number) => now - watchedAt(x) < STREMIO_LIVE && (x.state!.timeOffset || 0) > 1;
// authKey: the user's Stremio session key; tag: who, so each library's episode lists are cached on their own
export async function stremio(authKey: string | null, tag: string): Promise<StremioLive | null> {
  if (!authKey) return null;
  const d = await fetchJSON<{ error?: { message?: string }; result?: LibraryItem[] }>('https://api.strem.io/api/datastoreGet', { method: 'POST', timeout: 8000, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authKey, collection: 'libraryItem', ids: [], all: true }) });
  if (d.error) throw new Error(`stremio: ${d.error.message || 'error'}`);
  const items = (d.result || []).filter((x) => x.state?.lastWatched)
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
  // continue watching: a started episode or movie (2 min to 90 %), and one playing now
  const cont: ContinueCard[] = [];
  for (const x of items.filter((i) => watchedAt(i) > since)) {
    const st = x.state!, [season, ep] = vidParts(st.video_id);
    const pct = st.duration ? Math.round((st.timeWatched / st.duration) * 100) : 0;
    const base = { title: cleanName(x.name), poster: x.poster || null, at: watchedAt(x), url: link(x), type: x.type, id: x._id };
    if ((!isFull(st) && st.timeWatched >= 120000) || isPlaying(x, now)) cont.push(abs(x._id, { ...base, video: st.video_id || null, season, ep, pct, resume: true }));
  }
  const cur = items.find((x) => isPlaying(x, now));
  const nowPlaying = cur ? abs(cur._id, { title: cleanName(cur.name), type: cur.type, season: vidParts(cur.state!.video_id)[0], ep: vidParts(cur.state!.video_id)[1] }) : null;
  const watched7 = items.filter((x) => isFull(x.state!) && watchedAt(x) > now - 7 * 86400000).length;
  // for Listick's tracking: every title in the library, as Stremio has it now (movies of any age fill gaps;
  // series only within 30 days)
  const observe: StremioObserve[] = (d.result || []).filter((x) => x.state?.lastWatched).map((x) => ({ id: x._id, type: x.type,
    video: x.state!.video_id || null, watched: x.state!.timeWatched || 0, offset: x.state!.timeOffset || 0, duration: x.state!.duration || 0, at: watchedAt(x), full: isFull(x.state!),
    seen: x.state!.watched || null }));
  return { history, last: history[0] || null, continue: cont.slice(0, 15), now: nowPlaying, watched7, observe };
}
// ---------- the user's addons ----------
type Resource = string | { name: string; types?: string[]; idPrefixes?: string[] | null };
export type Addon = { transportUrl: string; manifest: { id?: string; types?: string[]; idPrefixes?: string[] | null; resources?: Resource[] } };
export type AddonVideo = { id: string; season?: number; episode?: number; number?: number; released?: string; tvdb_id?: number };
export const CINEMETA = 'com.linvo.cinemeta';
export async function stremioAddons(authKey: string): Promise<Addon[]> {
  const d = await fetchJSON<{ error?: { message?: string }; result?: { addons?: Addon[] } }>('https://api.strem.io/api/addonCollectionGet', { method: 'POST', timeout: 8000,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'AddonCollectionGet', authKey, update: true }) });
  if (d.error) throw new Error(`stremio addons: ${d.error.message || 'error'}`);
  return d.result?.addons || [];
}
// stremio-core Manifest::is_resource_supported
export const servesMeta = (a: Addon, type: string, id: string) => (a.manifest?.resources || []).some((r) => {
  const [name, types, prefixes] = typeof r === 'string' ? [r, a.manifest.types, a.manifest.idPrefixes] : [r.name, r.types, r.idPrefixes];
  return name === 'meta' && !!types?.includes(type) && (!prefixes?.length || prefixes.some((x) => id.startsWith(x)));
});
// stremio-core LibraryItemState::watched_bitfield order
const sortKey = (v: AddonVideo) => {
  const ep = v.episode ?? v.number, info = v.season != null && ep != null, at = v.released ? Date.parse(v.released) : NaN;
  return [info ? v.season! : -Infinity, info ? ep! : -Infinity, Number.isNaN(at) ? -Infinity : at];
};
export const stremioOrder = (vids: AddonVideo[]) => vids.map((v) => [sortKey(v), v] as const)
  .sort(([a], [b]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(([, v]) => v);
/* addon fetch: https, public addresses only, no redirects, 5 MB, 8 s */
const PRIVATE = new net.BlockList();
for (const [ip, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) PRIVATE.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(ip, bits, 'ipv6');
export const isPrivate = (ip: string) => PRIVATE.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
const publicLookup: net.LookupFunction = (host, opts, cb) =>
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err, '');
    if (!addrs.length || addrs.some((x) => isPrivate(x.address))) return cb(new Error('private address'), '');
    if (opts.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
  });
export function fetchAddon(url: string): Promise<unknown> {
  let u: URL;
  try { u = new URL(url); } catch { return Promise.resolve(null); }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || (net.isIP(host) && isPrivate(host))) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = https.get(u, { lookup: publicLookup, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let n = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => { n += c.length; if (n > 5 * 1024 * 1024) { req.destroy(); resolve(null); } else chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
      res.on('error', () => resolve(null));
    });
    const t = setTimeout(() => req.destroy(), 8000);
    req.on('error', () => resolve(null)).on('close', () => clearTimeout(t));
  });
}
/* meta per addon and title, in memory only */
type Got = { from?: string; vids: AddonVideo[] } | null;
const metaCache = new Map<string, { at: number; got: Got }>();
const asking = new Map<string, Promise<Got>>();
async function metaFrom(a: Addon, type: string, id: string): Promise<Got> {
  const k = `${a.transportUrl}|${type}|${id}`, c = metaCache.get(k);
  if (c && Date.now() - c.at < (c.got ? 6 : 0.5) * 3600000) return c.got;
  if (!asking.has(k)) asking.set(k, (async () => {
    const d = a.transportUrl.endsWith('/manifest.json')
      ? await fetchAddon(a.transportUrl.replace(/\/manifest\.json$/, `/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`)) as { meta?: { videos?: AddonVideo[] } } | null
      : null;
    const got = d?.meta ? { from: a.manifest.id, vids: stremioOrder((Array.isArray(d.meta.videos) ? d.meta.videos : []).filter((v) => typeof v?.id === 'string')) } : null;
    metaCache.set(k, { at: Date.now(), got });
    return got;
  })().finally(() => asking.delete(k)));
  return asking.get(k)!;
}
// the first addon in the user's order that answers
export async function addonVideos(addons: Addon[], type: string, id: string) {
  return (await Promise.all(addons.filter((x) => servesMeta(x, type, id)).map((a) => metaFrom(a, type, id)))).find((g) => g) ?? null;
}
// the aired episodes (season, episode) of the IMDb-listed series watched in the last 60 days, from Cinemeta: anime are numbered
// from their first episode by them
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
