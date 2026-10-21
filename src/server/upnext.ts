// Up next and the Airing calendar from the History here: every show or anime with a play in the last 60 days, whichever way it
// came in (Stremio, a mark here, an import). Up next is the episode after the furthest one watched once it has aired; one still
// to air waits (it is in the calendar) and comes back, NEW, when it airs. The calendar is their episodes airing this month and
// next. Episodes and air dates come from TMDB (Kitsu for anime only Kitsu has), exact air times from TVmaze where it knows the
// show. The worker works it out (refreshLive) when the History changes, and hourly otherwise.
import { q } from './db';
import { season } from './details';
import { tvSeasons } from './mapping';
import { getJSON, tmdb } from './sources';
import type { Episode, TitleType } from './types';
import { HOUR, safe } from './util';

export type UpNext = { key: string; type: TitleType; title: string; poster: string | null; backdrop: string | null; se: number; ep: number; at: number; airedAt: number | null };
export type AirEp = { key: string; title: string; poster: string | null; season: number | null; ep: number; at: number; dayOnly: boolean; watched: boolean; anime: boolean };
type Follow = { upNext: UpNext[]; schedule: AirEp[] };
type Followed = { key: string; type: TitleType; title: string; poster: string | null; backdrop: string | null; anime: number | null; season: number; episode: number; last: number };

const day = (t: number) => new Date(t).toLocaleDateString('sv-SE');   // YYYY-MM-DD in TZ, as TMDB's and Kitsu's air dates
// Kitsu lists an airing season's episodes before they air, without a date: one counts as out once a later one has aired
const aired = (list: Episode[], e: Episode, today: string) => (e.air ? e.air <= today : list.some((x) => x.ep > e.ep && !!x.air && x.air <= today));

// TVmaze now and then takes half a minute over a request (any of them, at random), and one given up on is no quicker when asked
// again, so its calls wait up to 45 s: this runs in the background
const TVMAZE_WAIT = 45000;
// TVmaze's id for a TMDB show (found by its TheTVDB or IMDb id; null: not on TVmaze), kept while the worker runs
const tvmazeIds = new Map<string, number | null>();
async function tvmazeId(key: string) {
  if (tvmazeIds.has(key)) return tvmazeIds.get(key)!;
  const ids = await tmdb<{ tvdb_id?: number | null; imdb_id?: string | null }>(`/tv/${key.split(':')[2]}/external_ids`);
  const by = ids.tvdb_id ? `thetvdb=${ids.tvdb_id}` : ids.imdb_id ? `imdb=${ids.imdb_id}` : null;
  const show = by ? await getJSON<{ id: number }>(`https://api.tvmaze.com/lookup/shows?${by}`, {}, TVMAZE_WAIT)
    .catch((e: Error) => { if (/-> 404$/.test(e.message)) return null; throw e; }) : null;
  tvmazeIds.set(key, show?.id ?? null);
  return show?.id ?? null;
}

// TVmaze's air times for a TMDB show: "season:episode" -> ms, kept 6 h (a failure 1 h)
const times = new Map<string, { at: number; ok: boolean; value: Map<string, number> }>();
async function airTimes(key: string) {
  const c = times.get(key);
  if (c && Date.now() - c.at < (c.ok ? 6 : 1) * HOUR) return c.value;
  const value = new Map<string, number>();
  const ok = !!await safe(async () => {
    const id = await tvmazeId(key);
    if (!id) return true;
    for (const e of await getJSON<{ season: number; number: number; airstamp?: string }[]>(`https://api.tvmaze.com/shows/${id}/episodes`, {}, TVMAZE_WAIT))
      if (e.airstamp) value.set(`${e.season}:${e.number}`, Date.parse(e.airstamp));
    return true;
  });
  times.set(key, { at: Date.now(), ok, value });
  return value;
}

// the episode after (se, ep): on in this season, else the first of the next season TMDB lists
async function nextOf(key: string, se: number, ep: number) {
  const here = await season(key, se, null);
  const n = here.find((e) => e.ep === ep + 1);
  if (n) return { se, list: here, e: n };
  if (!key.startsWith('tmdb:tv:')) return null;
  const later = (await tvSeasons(Number(key.split(':')[2]))).find((s) => s.n > se);
  if (!later) return null;
  const list = await season(key, later.n, null);
  return list[0] ? { se: later.n, list, e: list[0] } : null;
}

async function build(uid: string): Promise<Follow> {
  const since = Date.now() - 60 * 86400000, now = Date.now(), today = day(now);
  // the furthest episode watched of each title played lately (specials and films left out), the latest played first
  const followed = (await q.all<Followed>(`with recent as (select key, max(watched_at) last from history where user_id = ? and season > 0 group by key having max(watched_at) > ?)
    select distinct on (h.key) h.key, h.season, h.episode, r.last, t.type, t.title, t.poster, t.backdrop, t.anime
    from history h join recent r on r.key = h.key join titles t on t.key = h.key
    where h.user_id = ? and h.season > 0 order by h.key, h.season desc, h.episode desc`, uid, since, uid)).sort((a, b) => b.last - a.last).slice(0, 30);
  const from = day(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()), to = day(new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0).getTime());
  const upNext: UpNext[] = [], schedule: AirEp[] = [];
  for (const f of followed) {
    await safe(async () => {
      const stamps = f.key.startsWith('tmdb:tv:') ? await airTimes(f.key) : new Map<string, number>();
      const at = (se: number, e: Episode) => stamps.get(`${se}:${e.ep}`) ?? (e.air ? Date.parse(`${e.air}T12:00:00`) : null);
      const n = await nextOf(f.key, f.season, f.episode);
      if (n) {
        const t = at(n.se, n.e), out = stamps.has(`${n.se}:${n.e.ep}`) ? t! <= now : aired(n.list, n.e, today);
        if (out) upNext.push({ key: f.key, type: f.type, title: f.title, poster: f.poster, backdrop: f.backdrop, se: n.se, ep: n.e.ep, at: f.last, airedAt: t });
      }
      // the calendar: this season's and the next one's episodes airing this month or next, each marked if you watched it
      const seasons = [f.season, ...(n && n.se !== f.season ? [n.se] : [])];
      const seen = new Set((await q.all<{ season: number; episode: number }>('select distinct season, episode from history where user_id = ? and key = ?', uid, f.key)).map((r) => `${r.season}:${r.episode}`));
      for (const se of seasons)
        for (const e of await season(f.key, se, null)) {
          if (!e.air || e.air < from || e.air > to) continue;
          const stamp = stamps.get(`${se}:${e.ep}`);
          schedule.push({ key: f.key, title: f.title, poster: f.poster, season: f.type === 'anime' ? null : se, ep: e.ep, at: stamp ?? Date.parse(`${e.air}T12:00:00`),
            dayOnly: !stamp, watched: seen.has(`${se}:${e.ep}`), anime: !!f.anime || f.type === 'anime' });
        }
    });
  }
  return { upNext: upNext.slice(0, 15), schedule: schedule.sort((a, b) => a.at - b.at) };
}

// worked out again when the History changed (a play added or removed) or the day turned, else at most hourly. The first time it
// is awaited; after that the last answer is used while a new one is worked out in the background (TMDB, Kitsu and TVmaze can
// take a minute for a long list), so the live loop isn't held up
const cache = new Map<string, { sig: string; at: number; value: Follow }>();
const building = new Map<string, Promise<Follow>>();
export async function followOf(uid: string) {
  const s = (await q.one<{ n: number; t: number | null }>('select count(*)::int n, max(watched_at) t from history where user_id = ?', uid))!;
  const sig = `${s.n}|${s.t}|${day(Date.now())}`, c = cache.get(uid);
  if (c && c.sig === sig && Date.now() - c.at < HOUR) return c.value;
  let b = building.get(uid);
  if (!b) {
    b = build(uid).then((value) => { cache.set(uid, { sig, at: Date.now(), value }); return value; }).finally(() => building.delete(uid));
    building.set(uid, b);
    b.catch(() => {});   // a failed run in the background just waits for the next one
  }
  return c ? c.value : b;
}
