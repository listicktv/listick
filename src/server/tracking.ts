// Tracking: what Stremio shows (polled by the worker) turned into plays, Continue watching placed on TMDB / Kitsu titles, and
// the live state the page reads (with Up next and the calendar from upnext.ts).
import zlib from 'node:zlib';
import { q, tx } from './db';
import { details } from './details';
import { forYou } from './foryou';
import { cached, stremio } from './live';
import { canonEp, canonKey, fribb, loadFribb, resolve } from './mapping';
import { addPlay, collapseDoubles, nearPlay } from './plays';
import { getJSON, tmdb } from './sources';
import { getState, getUser, liveOf, setProfile, setState } from './store';
import { getTitle } from './titles';
import type { CinemetaVideo, Place, PlacedVideo, StremioLive, StremioObserve, TmdbFind, User } from './types';
import { followOf } from './upnext';
import { HOUR, present, safe } from './util';

// ---------- tracking: the worker passes on what it sees in Stremio; this decides what was watched ----------
// Movies, shows and anime come from Stremio; anime watched elsewhere is marked here. Plays older than the last one we already
// had when tracking began are left to the imports.
// a user's tracking starts at their latest play when it begins (earlier ones are the imports'), or now for a new user
export async function trackingSince(uid: string) {
  const u = await getUser(uid);
  if (u?.tracking_since) return u.tracking_since;
  const v = (await q.one<{ t: number | null }>('select max(watched_at) t from history where user_id = ?', uid))!.t || Date.now();
  await setProfile(uid, { tracking_since: v });
  return v;
}
// Stremio's watched record per series: "<anchor video>:<videos up to it>:<zlib bitmap>", bit i = the i-th video of the series'
// list (Cinemeta for IMDb ids, the Kitsu addon for anime). A video id is "tt…:season:episode" or "kitsu:id:episode".
type Vid = { id: string; tvdb: number | null };
const metaVideos = new Map<string, { at: number; vids: Vid[] }>();
async function seriesVideos(series: string) {
  const c = metaVideos.get(series);
  if (c && Date.now() - c.at < 6 * HOUR) return c.vids;
  const base = series.startsWith('kitsu:') ? 'https://anime-kitsu.strem.fun' : 'https://v3-cinemeta.strem.io';
  const d = await getJSON<{ meta?: { videos?: CinemetaVideo[] } }>(`${base}/meta/series/${encodeURIComponent(series)}.json`);
  const vids = (d.meta?.videos || []).map((v) => ({ id: v.id, tvdb: v.tvdb_id || null }));
  metaVideos.set(series, { at: Date.now(), vids });
  return vids;
}
// an episode as TMDB has it: Stremio and TMDB can split or number a series differently (Stremio's "Monster" S4 is TMDB's
// "Monster: The Lizzie Borden Story" S1), so each episode is looked up by its TheTVDB id; the series match is the fallback
const tvdbEp = new Map<number, Place | null>();
async function placeOf(video: string, vids: Vid[], fallbackKey: string | null): Promise<Place | null> {
  if (video.startsWith('kitsu:')) return fallbackKey ? canonEp(fallbackKey, 1, epOf(video)[1]) : null;
  const tv = vids.find((v) => v.id === video)?.tvdb;
  if (tv) {
    if (!tvdbEp.has(tv)) {
      const r = await tmdb<TmdbFind>(`/find/${tv}?external_source=tvdb_id`).catch(() => null);
      const e = r?.tv_episode_results?.[0];
      tvdbEp.set(tv, e ? { key: `tmdb:tv:${e.show_id}`, se: e.season_number, ep: e.episode_number } : null);
    }
    const p = tvdbEp.get(tv);
    if (p) {
      if (!await getTitle(p.key)) await details(p.key).catch(() => null);
      return (await getTitle(p.key))?.anime ? null : p;   // anime with an IMDb id goes on its Kitsu entry (placeAny)
    }
  }
  const [se, ep] = epOf(video);
  return fallbackKey && se >= 0 ? { key: fallbackKey, se, ep } : null;
}
export function decodeWatched(field: string | null, vids: Vid[]) {
  if (!field) return [];
  const parts = field.split(':'), data = parts.pop()!, len = Number(parts.pop()), anchor = parts.join(':');
  const ids = vids.map((v) => v.id), at = ids.indexOf(anchor);
  if (at < 0 || !len) return [];
  let bits: Buffer;
  try { bits = zlib.inflateSync(Buffer.from(data, 'base64')); } catch { return []; }
  const off = at - (len - 1), out: string[] = [];
  for (let i = 0; i < len; i++) if (bits[i >> 3] & (1 << (i & 7)) && ids[i + off]) out.push(ids[i + off]);
  return out;
}
export const seriesOf = (video: string | null | undefined) => (video?.startsWith('kitsu:') ? video.split(':').slice(0, 2).join(':') : video?.split(':')[0]);
// a video as [season, episode]: anime episodes go under season 1, counted from the first as Kitsu does
export const epOf = (video: string | null | undefined): [number, number] => {
  const p = (video || '').split(':');
  if (p[0] === 'kitsu') return p.length >= 3 ? [1, Number(p[2])] : [-1, -1];
  return p.length >= 3 ? [Number(p[1]), Number(p[2])] : [-1, -1];
};
// an anime episode recorded twice within a week (under its Kitsu and its IMDb id in Stremio, or by an import) is one watch; a
// Kitsu entry's episode is stored where it sits on TMDB
async function addWatch(uid: string, key: string, se: number, ep: number, at: number, source: string, approx = 0) {
  ({ key, se, ep } = await canonEp(key, se, ep));
  if ((await getTitle(key))?.anime && await nearPlay(uid, key, se, ep, at - 7 * 86400000, at + 7 * 86400000)) return 0;
  return addPlay(uid, key, se, ep, at, source, approx);
}
// a movie's or show's key; an anime show with an IMDb id is placed per episode on its Kitsu entry instead (placeAny), while an
// anime film keeps its own key
async function keyOfSeries(series: string, movie = false) {
  if (series.startsWith('kitsu:')) {
    const key = `kitsu:anime:${series.split(':')[1]}`;
    if (!await getTitle(key)) await details(key).catch(() => null);
    return await getTitle(key) ? key : null;
  }
  const key = await resolve({ imdb: series }).catch(() => null);
  return key && (movie || !(await getTitle(key))?.anime) ? key : null;
}
// a movie by its TMDB key, its title fetched once if Listick doesn't have it yet
async function keyOfMovie(key: string) {
  if (!await getTitle(key)) await details(key).catch(() => null);
  return await getTitle(key) ? key : null;
}
// what was last seen of a Stremio library item (sync_state 'stremio')
type StremioSeen = { video: string | null; watched: number; offset?: number; duration: number; at: number; full: boolean; seen: string | null };
// items: { id, type, video, watched (time played), offset (position), duration (ms), at (ms), full, seen (Stremio's watched record) }
// over 70 % played: Stremio's watched tick
export const played = (s: { watched: number; duration: number }) => !!s.duration && s.watched > s.duration * 0.7;
// Stremio sets the position back to 0, or 1 on the next video, at the end
export const stillOpen = (s: { video: string | null; offset?: number }) => !!s.video && (s.offset ?? 0) > 1;
async function observeStremio(uid: string, items: StremioObserve[]) {
  const since = await trackingSince(uid);
  let added = 0;
  for (const x of items) {
    const prev = await getState<StremioSeen>(uid, 'stremio', x.id);
    const cur: StremioSeen = { video: x.video || null, watched: x.watched || 0, offset: x.offset || 0, duration: x.duration || 0, at: x.at, full: !!x.full, seen: x.seen || null };
    if (prev && JSON.stringify(prev) === JSON.stringify(cur)) continue;
    await setState(uid, 'stremio', x.id, cur);
    const open = stillOpen(cur);
    // movies: Stremio keeps the real last-watched date, so a watched movie we have no play of is added at any age. A movie
    // opened from Listick's catalogs is in Stremio's library as tmdb:<id> (its video the IMDb id), not tt<id>
    if (x.type === 'movie') {
      const tmdb = /^tmdb:\d+$/.test(x.id) ? `tmdb:movie:${x.id.slice(5)}` : null, imdb = /^tt\d+$/.test(x.id) ? x.id : /^tt\d+$/.test(cur.video || '') ? cur.video! : null;
      if ((!tmdb && !imdb) || !cur.full || open) continue;
      if (prev?.full && prev.at === cur.at) continue;
      const key = tmdb ? await keyOfMovie(tmdb) : await keyOfSeries(imdb!, true);
      if (!key) continue;
      // addPlay skips it when that viewing is already recorded (within 6 h); an earlier viewing is a rewatch, not a match
      if (!prev || cur.at >= since) added += await addPlay(uid, key, -1, -1, cur.at, 'stremio');
      continue;
    }
    const series = seriesOf((cur.seen || '').split(':').slice(0, -2).join(':') || cur.video);
    if (!series) continue;
    const key = await keyOfSeries(series);
    const vids = await seriesVideos(series).catch((): Vid[] => []);
    const now = new Set(decodeWatched(cur.seen, vids));
    const record = async (video: string, at: number, approx = 0) => {
      const p = await placeAny(video, vids, key, series);
      return p ? addWatch(uid, p.key, p.se, p.ep, at, 'stremio', approx) : 0;
    };
    let fresh: string[] = [];
    if (prev) {
      if (cur.at < since) continue;
      // newly ticked episodes since last time, in series order, the last one at the last-watched time; not the open one
      const before = new Set(decodeWatched(prev.seen, vids));
      fresh = vids.map((v) => v.id).filter((v) => now.has(v) && !before.has(v) && !(open && v === cur.video));
      for (const [i, v] of fresh.entries()) added += await record(v, cur.at - (fresh.length - 1 - i) * 60000);
      // the episode moved on from, rewatches too
      if (prev.video && prev.video !== cur.video && !fresh.includes(prev.video) && prev.at >= since && played(prev))
        added += await record(prev.video, prev.at);
    } else if (Date.now() - cur.at < 30 * 86400000) {
      added += await fillGaps(uid, vids, now, cur, series, key);
    }
    // the open episode played to its end
    const ended = prev && prev.video === cur.video && stillOpen(prev) && !open && played(cur);
    if (ended && cur.video && cur.at >= since && !fresh.includes(cur.video)) added += await record(cur.video, cur.at);
  }
  return added;
}
// first sight of a series watched in the last 30 days: episodes of the current season that Stremio has ticked but we have no play
// for are added, their times estimated back from the last-watched time (45 min apart) and marked approx = 2
async function fillGaps(uid: string, vids: Vid[], now: Set<string>, cur: StremioSeen, series: string, key: string | null) {
  const [se] = epOf(cur.video || [...now].pop());
  if (se < 0) return 0;
  const watched = vids.map((v) => v.id).filter((v) => now.has(v) && epOf(v)[0] === se).reverse().slice(0, 30);
  let t = cur.at, added = 0;
  for (const v of watched) {
    const p = await placeAny(v, vids, key, series);
    if (!p) continue;
    const had = (await q.one<{ t: number | null }>('select min(watched_at) t from history where user_id = ? and key = ? and season = ? and episode = ?', uid, p.key, p.se, p.ep))!.t;
    if (had) { t = Math.min(t, had) - 45 * 60000; continue; }
    added += await addWatch(uid, p.key, p.se, p.ep, t, 'stremio', 2);
    t -= 45 * 60000;
  }
  if (added) console.log(`tracking: ${added} earlier episode(s) of ${series} filled from Stremio's watched record`);
  return added;
}
// anime stored under Kitsu keys move to their TMDB show once Fribb maps them (at start and daily, so entries mapped later follow)
export async function moveAnimeToTmdb() {
  type R = { id?: number; watched_at?: number; user_id: string; key: string; season: number; episode: number };
  const moves: (Place & { table: string; r: R })[] = [];
  for (const table of ['history', 'ratings', 'playback'])
    for (const r of await q.all<R>(`select ${table === 'history' ? 'id, watched_at, ' : ''}user_id, key, season, episode from ${table} where key like 'kitsu:anime:%'`)) {
      const c = await canonEp(r.key, r.season, r.episode);
      if (c.key !== r.key) moves.push({ table, r, ...c });
    }
  const lists: { from: string; to: string }[] = [];
  for (const r of await q.all<{ key: string }>(`select distinct key from watchlist where key like 'kitsu:anime:%'`)) {
    const k = await canonKey(r.key);
    if (k !== r.key) lists.push({ from: r.key, to: k });
  }
  if (!moves.length && !lists.length) return 0;
  await tx(async (t) => {
    for (const m of moves) {
      // a play or rating TMDB's place already has stays; the Kitsu one goes
      const { r } = m, same = 'user_id = ? and key = ? and season = ? and episode = ?';
      const taken = m.table === 'history'
        ? await t.one(`select 1 from history where ${same} and watched_at = ?`, r.user_id, m.key, m.se, m.ep, r.watched_at)
        : await t.one(`select 1 from ${m.table} where ${same}`, r.user_id, m.key, m.se, m.ep);
      if (taken) await t.run(`delete from ${m.table} where ${same}${m.table === 'history' ? ' and id = ?' : ''}`, r.user_id, r.key, r.season, r.episode, ...(m.table === 'history' ? [r.id] : []));
      else await t.run(`update ${m.table} set key = ?, season = ?, episode = ? where ${same}${m.table === 'history' ? ' and id = ?' : ''}`,
        m.key, m.se, m.ep, r.user_id, r.key, r.season, r.episode, ...(m.table === 'history' ? [r.id] : []));
    }
    for (const l of lists) {
      await t.run('insert into watchlist (user_id, key, added_at) select user_id, ?, added_at from watchlist where key = ? on conflict do nothing', l.to, l.from);
      await t.run('delete from watchlist where key = ?', l.from);
    }
  });
  await collapseDoubles();
  console.log(`anime: ${moves.length} plays/ratings and ${lists.length} watchlist entries moved from Kitsu to TMDB`);
  return moves.length + lists.length;
}
// for Continue watching: where a Stremio episode sits on TMDB/Kitsu (title, artwork, episode number), so cards match the History row
async function places(videos: string[]) {
  const out: Record<string, PlacedVideo> = {};
  for (const video of videos.slice(0, 40)) {
    const series = seriesOf(video);
    if (!series || !/^(tt\d+|kitsu:\d+):/.test(video)) continue;
    const vids = await seriesVideos(series).catch((): Vid[] => []);
    const p = await placeAny(video, vids, await keyOfSeries(series), series).catch(() => null);
    const t = p && await getTitle(p.key);
    if (p && t) out[video] = { key: p.key, se: p.se, ep: p.ep, type: t.type, title: t.title, label: t.label, poster: t.poster, backdrop: t.backdrop };
  }
  return out;
}
// where a Stremio episode goes: its TMDB/Kitsu place, or for an IMDb-id anime episode its Kitsu entry
async function placeAny(video: string, vids: Vid[], key: string | null, series: string) {
  return (await placeOf(video, vids, key)) || (series.startsWith('tt') ? await animePlace(series, video, vids).catch(() => null) : null);
}
// an IMDb-id anime episode (Stremio's WIND BREAKER S2E4) as Kitsu counts it: the Kitsu entry for its TheTVDB season from Fribb's
// mapping (episode 4 of the second season's entry), else the series' single entry counted from its first episode
async function animePlace(imdb: string, video: string, vids: Vid[]) {
  await loadFribb();
  const [se, ep] = epOf(video), entries = fribb.byImdb.get(imdb) || [];
  const bySeason = entries.find((e) => e.season === se), whole = entries.length === 1 && entries[0].season == null ? entries[0] : null;
  const m = bySeason || whole;
  if (!m) return null;
  const n = bySeason ? ep : vids.map((v) => v.id).filter((v) => epOf(v)[0] > 0).indexOf(video) + 1;
  const key = `kitsu:anime:${m.kitsu}`;
  if (!await getTitle(key)) await details(key).catch(() => null);
  return n > 0 && await getTitle(key) ? canonEp(key, 1, n) : null;
}

// For you's anime picks start from the anime you played lately: their MyAnimeList ids through Fribb's mapping
async function recentMal(uid: string) {
  await loadFribb();
  const rows = await q.all<{ key: string; season: number }>(`select h.key, max(h.season) season, max(h.watched_at) last from history h join titles t on t.key = h.key
    where h.user_id = ? and t.anime = 1 group by h.key order by last desc limit 20`, uid);
  const out: number[] = [];
  for (const r of rows) {
    const [, kind, id] = r.key.split(':');
    const mal = kind === 'anime' ? fribb.map.get(Number(id))?.mal
      : kind === 'tv' ? ((fribb.byTmdb.get(Number(id)) || []).find((e) => e.season === r.season) || fribb.byTmdb.get(Number(id))?.[0])?.mal : null;
    if (mal && !out.includes(mal)) out.push(mal);
  }
  return out;
}

// ---------- live: Stremio and the History, every 15 s (the worker) ----------
// What Stremio shows now feeds tracking (new plays), Continue watching (each Stremio episode placed on its TMDB/Kitsu title,
// e.g. Stremio's "Monster" S4 is TMDB's Lizzie Borden Story) and the for-you rows; the History gives Up next and the
// calendar. Saved per user in live_state (without the raw observations, which only tracking needs), where the page reads it.
const observed = new Map<string, string>();   // uid|source -> the last observation recorded (worker memory)
const placed: Record<string, PlacedVideo | null> = {};     // Stremio video id -> its TMDB/Kitsu title and episode (the same for everyone)
const savedLive = new Map<string, string>();   // uid -> the JSON last written, so an unchanged answer isn't written again
const omitObserve = <T extends { observe: unknown }>(x: T | null) => x && (({ observe, ...rest }) => rest)(x);
// a changed source (another Stremio account) starts from nothing
export const forgetLive = (uid: string) => { savedLive.delete(uid); return q.run('delete from live_state where user_id = ?', uid); };
export async function refreshLive(u: User) {
  const uid = u.id;
  // cached per user and per key, so a changed key or name starts fresh
  const sr: StremioLive | null = u.stremio_key ? await cached(`stremio:${uid}:${u.stremio_key.slice(0, 8)}`, 120000, () => stremio(u.stremio_key, uid)) : null;
  const videos = (sr?.continue || []).map((c) => c.video).filter((v): v is string => !!v && !(v in placed));
  if (videos.length) { const got = await safe(() => places(videos)); if (got) for (const v of videos) placed[v] = got[v] || null; }
  if (sr?.continue) for (const c of sr.continue) c.place = (c.video && placed[c.video]) || null;
  for (const c of sr?.continue || []) {
    const kk = c.id.startsWith('kitsu:') ? `kitsu:anime:${c.id.split(':')[1]}` : null;
    c.ids = [...new Set([kk || c.id, kk && await canonKey(kk), c.place?.key])].filter(present);
  }
  // only when it changed; a failed run is tried again next time
  const track = async <T>(src: string, obs: T[] | undefined, fn: (uid: string, items: T[]) => Promise<number>) => {
    const sig = obs && JSON.stringify(obs);
    if (!sig || observed.get(`${uid}|${src}`) === sig) return;
    const added = await safe(() => fn(uid, obs!));
    if (added != null) { observed.set(`${uid}|${src}`, sig); if (added) console.log(`tracking: ${added} new ${src} play(s) for ${u.name}`); }
  };
  await track('stremio', sr?.observe, observeStremio);
  const imdbs = [...new Set((sr?.history || []).map((h) => h.id).filter((id) => /^tt\d+$/.test(id || '')))].slice(0, 20);
  const mals = (await safe(() => recentMal(uid))) || [];
  const fy = imdbs.length || mals.length ? await safe(() => forYou(uid, imdbs, mals)) : null;
  const follow = await safe(() => followOf(uid));
  const prev = await liveOf(uid);
  const value = JSON.stringify({ stremio: omitObserve(sr), forYou: fy ?? prev.forYou, upNext: follow?.upNext ?? prev.upNext ?? [], schedule: follow?.schedule ?? prev.schedule ?? [] });
  if (savedLive.get(uid) === value) return;
  await q.run(`insert into live_state (user_id, at, value) values (?, ?, ?::jsonb) on conflict (user_id) do update set at = excluded.at, value = excluded.value`,
    uid, Date.now(), value);
  savedLive.set(uid, value);
}

