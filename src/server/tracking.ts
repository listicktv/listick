// Tracking: what Stremio shows (polled by the worker) turned into plays, Continue watching placed on TMDB / Kitsu titles, and
// the live state the page reads (with Up next and the calendar from upnext.ts).
import zlib from 'node:zlib';
import { q, tx } from './db';
import { details } from './details';
import { forYou } from './foryou';
import { addonVideos, cached, CINEMETA, stremio, stremioAddons, type Addon } from './live';
import { canonEp, canonKey, fribb, loadFribb, resolve } from './mapping';
import { addPlay, collapseDoubles, nearPlay } from './plays';
import { getJSON, tmdb } from './sources';
import { getState, getUser, liveOf, setProfile, setState } from './store';
import { getTitle } from './titles';
import type { CinemetaVideo, Place, PlacedVideo, StremioLive, StremioObserve, TmdbFind, User } from './types';
import { tmdbOnDay } from './tvdb';
import { followOf } from './upnext';
import { HOUR, present, safe } from './util';

// ---------- tracking: the worker passes on what it sees in Stremio; this decides what was watched ----------
// Movies, shows and anime come from Stremio.
// a user's tracking starts at their latest play when it begins (earlier ones are the imports'), or now for a new user
export async function trackingSince(uid: string) {
  const u = await getUser(uid);
  if (u?.tracking_since) return u.tracking_since;
  const v = (await q.one<{ t: number | null }>('select max(watched_at) t from history where user_id = ?', uid))!.t || Date.now();
  await setProfile(uid, { tracking_since: v });
  return v;
}
// watched record: "<last watched video>:<videos up to it>:<zlib bitmap>"; fallback lists: Cinemeta, Kitsu addon, TMDB seasons
// own: addon's own numbering, placed by air date
type Vid = { id: string; tvdb: number | null; se?: number; ep?: number; air?: string | null; own?: boolean };
const metaVideos = new Map<string, { at: number; vids: Vid[] }>();
async function seriesVideos(series: string) {
  const c = metaVideos.get(series);
  if (c && Date.now() - c.at < 6 * HOUR) return c.vids;
  if (series.startsWith('tmdb:')) {
    const id = series.slice(5), d = await tmdb<{ seasons?: { season_number: number; episode_count: number }[] }>(`/tv/${id}`);
    const vids = (d.seasons || []).filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number)
      .flatMap((s) => Array.from({ length: s.episode_count }, (_, i) => ({ id: `tmdb:${id}:${s.season_number}:${i + 1}`, tvdb: null })));
    metaVideos.set(series, { at: Date.now(), vids });
    return vids;
  }
  const base = series.startsWith('kitsu:') ? 'https://anime-kitsu.strem.fun' : 'https://v3-cinemeta.strem.io';
  const d = await getJSON<{ meta?: { videos?: CinemetaVideo[] } }>(`${base}/meta/series/${encodeURIComponent(series)}.json`);
  const vids = (d.meta?.videos || []).map((v) => ({ id: v.id, tvdb: v.tvdb_id || null }));
  metaVideos.set(series, { at: Date.now(), vids });
  return vids;
}
// an episode as TMDB has it: Stremio and TMDB can split or number a series differently (Stremio's "Monster" S4 is TMDB's
// "Monster: The Lizzie Borden Story" S1), so each episode is looked up by its TheTVDB id; the series match is the fallback
const tvdbEp = new Map<number, Place | null>();
// TheTVDB id: the list's, else Cinemeta's
export async function tvdbOf(video: string, vids: Vid[], fallbackKey: string | null, cinemeta = seriesVideos) {
  const tv = vids.find((v) => v.id === video)?.tvdb;
  if (tv || fallbackKey || !/^tt\d/.test(video)) return tv;
  return (await cinemeta(video.split(':')[0]).catch((): Vid[] => [])).find((v) => v.id === video)?.tvdb;
}
async function placeOf(video: string, vids: Vid[], fallbackKey: string | null): Promise<Place | null> {
  if (/^(kitsu|mal|anilist):/.test(video)) return fallbackKey ? canonEp(fallbackKey, 1, epOf(video)[1]) : null;
  const tv = await tvdbOf(video, vids, fallbackKey);
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
  const v = vids.find((x) => x.id === video), [se, ep] = v?.se != null && v.ep != null ? [v.se, v.ep] : epOf(video);
  if (!fallbackKey || se < 0) return null;
  return (v?.own && await byAirDate(fallbackKey, se, ep, v, vids)) || { key: fallbackKey, se, ep };
}
// TMDB episode by air date; null when the addon's numbers match or the day is ambiguous
async function byAirDate(key: string, se: number, ep: number, v: Vid, vids: Vid[]): Promise<Place | null> {
  if (!v.air || !key.startsWith('tmdb:tv:')) return null;
  const day = v.air.slice(0, 10), hits = await tmdbOnDay(key.slice(8), day, se).catch(() => []);
  if (hits.some((h) => h.se === se && h.ep === ep)) return null;
  const sameDay = vids.filter((x) => x.air?.slice(0, 10) === day);
  const hit = hits.length === 1 ? hits[0] : hits.length === sameDay.length ? hits[sameDay.indexOf(v)] : null;
  return hit ? { key, se: hit.se, ep: hit.ep } : null;
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
// video ids: tt<imdb>:se:ep, <source>:<id>:se:ep (tmdb, tvdb), <source>:<id>:ep (kitsu, mal, anilist; season 1)
export const seriesOf = (video: string | null | undefined) => (video && (/^tt\d/.test(video) ? video.split(':')[0] : video.split(':').slice(0, 2).join(':'))) || undefined;
export const epOf = (video: string | null | undefined): [number, number] => {
  const p = (video || '').split(':');
  if (/^tt\d/.test(p[0])) return p.length >= 3 ? [Number(p[1]), Number(p[2])] : [-1, -1];
  return p.length >= 4 ? [Number(p[2]), Number(p[3])] : p.length === 3 ? [1, Number(p[2])] : [-1, -1];
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
  if (series.startsWith('tmdb:')) return keyOfMovie(`tmdb:tv:${series.slice(5)}`);
  const key = await resolve({ imdb: series }).catch(() => null);
  return key && (movie || !(await getTitle(key))?.anime) ? key : null;
}
// a movie or show by its TMDB key, its title fetched once if Listick doesn't have it yet
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
// mal / anilist -> kitsu, tvdb -> tmdb, kitsu film -> tmdb film; null: unmapped
const tvdbTmdb = new Map<string, string | null>();
async function knownId(src: string, n: string, movie: boolean): Promise<string | null> {
  if (src === 'mal' || src === 'anilist') {
    await loadFribb();
    const k = (src === 'mal' ? fribb.byMal : fribb.byAnilist).get(Number(n));
    return k ? knownId('kitsu', String(k), movie) : null;
  }
  if (src === 'kitsu') {
    if (!movie) return `kitsu:${n}`;
    await loadFribb();
    const m = fribb.map.get(Number(n))?.tmdb;
    return m?.type === 'movie' ? `tmdb:${m.id}` : null;
  }
  const k = `${movie ? 'm' : 's'}${n}`;
  if (!tvdbTmdb.has(k)) {
    const r = await tmdb<TmdbFind>(`/find/${n}?external_source=tvdb_id`), t = (movie ? r.movie_results : r.tv_results)?.[0];
    tvdbTmdb.set(k, t ? `tmdb:${t.id}` : null);
  }
  return tvdbTmdb.get(k)!;
}
// leading addon id swapped for the known one
export async function knownVideo(s: string | null, movie: boolean, lookup = knownId) {
  const m = s && /^(mal|anilist|tvdb|kitsu):(\d+)/.exec(s);
  if (!m || (m[1] === 'kitsu' && !movie)) return s;
  const to = await lookup(m[1], m[2], movie);
  return to && to + s!.slice(m[0].length);
}
// episode list: the user's addon's (raw) when it has the anchor, else the fallback; addons get 3 s (settled: false past that)
async function listOf(addons: Addon[], type: string, id: string, anchor: string | null, known: string) {
  const late = Symbol(), ask = anchor ? addonVideos(addons, type, id).catch(() => null) : null;
  const res = ask && await Promise.race([ask, new Promise<typeof late>((r) => setTimeout(r, 3000, late))]);
  const settled = res !== late, got = res === late ? null : res;
  if (got?.vids.some((v) => v.id === anchor)) {
    const own = got.from !== CINEMETA;
    return { raw: true, settled, vids: got.vids.map((v): Vid => ({ id: v.id, tvdb: v.tvdb_id || null, se: v.season, ep: v.episode ?? v.number, air: v.released || null, own: own && !v.id.startsWith('tmdb:') })) };
  }
  return { raw: false, settled, vids: await seriesVideos(known).catch((): Vid[] => []) };
}
async function observeStremio(uid: string, items: StremioObserve[], addons: Addon[] = []) {
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
      const id = (await knownVideo(x.id, true)) || x.id, video = await knownVideo(cur.video, true);
      const tmdb = /^tmdb:\d+$/.test(id) ? `tmdb:movie:${id.slice(5)}` : null, imdb = /^tt\d+$/.test(id) ? id : /^tt\d+$/.test(video || '') ? video! : null;
      if ((!tmdb && !imdb) || !cur.full || open) continue;
      if (prev?.full && prev.at === cur.at) continue;
      const key = tmdb ? await keyOfMovie(tmdb) : await keyOfSeries(imdb!, true);
      if (!key) continue;
      // addPlay skips it when that viewing is already recorded (within 6 h); an earlier viewing is a rewatch, not a match
      if (!prev || cur.at >= since) added += await addPlay(uid, key, -1, -1, cur.at, 'stremio');
      continue;
    }
    // c / p: cur / prev read against the list in use
    const anchor = (cur.seen || '').split(':').slice(0, -2).join(':') || cur.video, series = await knownVideo(seriesOf(anchor) || null, false);
    if (!series) continue;
    const key = await keyOfSeries(series);
    const { raw, vids } = await listOf(addons, x.type, x.id, anchor, series);
    const read = async (s: StremioSeen) => raw ? s : { ...s, video: await knownVideo(s.video, false), seen: await knownVideo(s.seen, false) };
    const c = await read(cur), p = prev && await read(prev);
    const now = new Set(decodeWatched(c.seen, vids));
    const record = async (video: string, at: number, approx = 0) => {
      const pl = await placeAny(video, vids, key, series);
      return pl ? addWatch(uid, pl.key, pl.se, pl.ep, at, 'stremio', approx) : 0;
    };
    let fresh: string[] = [];
    if (p) {
      if (c.at < since) continue;
      // newly ticked episodes since last time, in series order, the last one at the last-watched time; not the open one
      const before = new Set(decodeWatched(p.seen, vids));
      fresh = vids.map((v) => v.id).filter((v) => now.has(v) && !before.has(v) && !(open && v === c.video));
      for (const [i, v] of fresh.entries()) added += await record(v, c.at - (fresh.length - 1 - i) * 60000);
      // the episode moved on from, rewatches too
      if (p.video && p.video !== c.video && !fresh.includes(p.video) && p.at >= since && played(p))
        added += await record(p.video, p.at);
    } else if (Date.now() - c.at < 30 * 86400000) {
      added += await fillGaps(uid, vids, now, c, series, key);
    }
    // the open episode played to its end
    const ended = p && p.video === c.video && stillOpen(p) && !open && played(c);
    if (ended && c.video && c.at >= since && !fresh.includes(c.video)) added += await record(c.video, c.at);
  }
  return added;
}
// first sight of a series watched in the last 30 days: the episodes Stremio has ticked in the season of the last ticked one that we have no
// play for are added, their times estimated back from the last-watched time (45 min apart) and marked approx = 2
async function fillGaps(uid: string, vids: Vid[], now: Set<string>, cur: StremioSeen, series: string, key: string | null) {
  const [se] = epOf([...now].pop() || cur.video);
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
// retry: placed before the addon answered
async function places(cards: { id: string; type: string; video: string }[], addons: Addon[]) {
  const out: Record<string, PlacedVideo> = {}, retry = new Set<string>();
  await Promise.all(cards.slice(0, 40).map(async ({ id, type, video: original }) => {
    const series = await knownVideo(seriesOf(original) || null, false).catch(() => null);
    if (!series || !/^(tt\d+|kitsu:\d+|tmdb:\d+)$/.test(series)) return;
    const { raw, settled, vids } = await listOf(addons, type, id, original, series);
    if (!settled) retry.add(original);
    const video = raw ? original : await knownVideo(original, false).catch(() => null);
    const p = video && await placeAny(video, vids, await keyOfSeries(series), series).catch(() => null);
    const t = p && await getTitle(p.key);
    if (p && t) out[original] = { key: p.key, se: p.se, ep: p.ep, type: t.type, title: t.title, label: t.label, poster: t.poster, backdrop: t.backdrop };
  }));
  return { out, retry };
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
const placed: Record<string, PlacedVideo | null> = {};     // uid|Stremio video id -> its TMDB/Kitsu title and episode
const savedLive = new Map<string, string>();   // uid -> the JSON last written, so an unchanged answer isn't written again
const omitObserve = <T extends { observe: unknown }>(x: T | null) => x && (({ observe, ...rest }) => rest)(x);
// a changed source (another Stremio account) starts from nothing
export const forgetLive = (uid: string) => { savedLive.delete(uid); return q.run('delete from live_state where user_id = ?', uid); };
export async function refreshLive(u: User) {
  const uid = u.id;
  // cached per user and per key, so a changed key or name starts fresh
  const sr: StremioLive | null = u.stremio_key ? await cached(`stremio:${uid}:${u.stremio_key.slice(0, 8)}`, 30000, () => stremio(u.stremio_key, uid)) : null;
  // the user's addons
  const addons = u.stremio_key ? (await cached(`stremioAddons:${uid}:${u.stremio_key.slice(0, 8)}`, 6 * HOUR, () => stremioAddons(u.stremio_key!))) || [] : [];
  const todo = (sr?.continue || []).filter((c): c is typeof c & { video: string } => !!c.video && !(`${uid}|${c.video}` in placed));
  const got = todo.length ? await safe(() => places(todo, addons)) : null;
  if (got) for (const c of todo) if (!got.retry.has(c.video)) placed[`${uid}|${c.video}`] = got.out[c.video] || null;
  if (sr?.continue) for (const c of sr.continue) c.place = (c.video && (placed[`${uid}|${c.video}`] ?? got?.out[c.video])) || null;
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
  await track('stremio', sr?.observe, (id, items) => observeStremio(id, items, addons));
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

