// TheTVDB (TVDB_API_KEY, optional): episode names, stories and images where TMDB has none
import { fetchJSON, getJSON, tmdb } from './sources';
import { fromTmdb, saveTitles } from './titles';
import type { Episode, TmdbFind } from './types';
import { HOUR, env } from './util';

type TvdbEpisode = { seasonNumber: number; number: number; name?: string | null; overview?: string | null; aired?: string | null; image?: string | null };
type TvdbPage = { data?: { episodes?: TvdbEpisode[] }; links?: { next?: string | null } };

export const tvdbOn = () => !!env('TVDB_API_KEY');
let token: { value: string; at: number } | null = null;
async function auth() {
  if (token && Date.now() - token.at < 20 * 24 * HOUR) return token.value;
  const r = await fetchJSON<{ data?: { token?: string } }>('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apikey: env('TVDB_API_KEY') }) });
  if (!r.data?.token) throw new Error('thetvdb: no token');
  token = { value: r.data.token, at: Date.now() };
  return token.value;
}
const tvdb = async <T>(path: string) => getJSON<T>(`https://api4.thetvdb.com/v4${path}`, { Authorization: `Bearer ${await auth()}` });

const ids = new Map<string, number | null>();
async function tvdbId(tmdbId: string) {
  if (!ids.has(tmdbId)) ids.set(tmdbId, (await tmdb<{ tvdb_id?: number | null }>(`/tv/${tmdbId}/external_ids`)).tvdb_id || null);
  return ids.get(tmdbId)!;
}
const seasons = new Map<string, { at: number; list: TvdbEpisode[] }>();
async function tvdbSeason(id: number, season: number) {
  const k = `${id}|${season}`, c = seasons.get(k);
  if (c && Date.now() - c.at < 6 * HOUR) return c.list;
  const list: TvdbEpisode[] = [];
  for (let page = 0; page < 10; page++) {
    const r = await tvdb<TvdbPage>(`/series/${id}/episodes/default?page=${page}&season=${season}`);
    list.push(...(r.data?.episodes || []).filter((e) => e.seasonNumber === season));
    if (!r.links?.next) break;
  }
  seasons.set(k, { at: Date.now(), list });
  return list;
}
const generic = (n: string | null | undefined) => !n || /^(episode|episodio|épisode|folge|aflevering)\s*#?\d+$/i.test(n.trim()) || /^\d+$/.test(n.trim());
const dated = (n: string | null | undefined) => !!n && /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(n.trim());

// a season's episodes with their gaps filled: matched by number when both list the same count, else by air date
export async function fillFromTvdb(tmdbId: string, season: number, eps: Episode[]) {
  if (!tvdbOn() || !eps.some((e) => generic(e.name) || !e.overview || !e.still)) return eps;
  const id = await tvdbId(tmdbId);
  if (!id) return eps;
  const list = await tvdbSeason(id, season);
  const byNumber = list.length === eps.length;
  return eps.map((e) => {
    const t = byNumber ? list.find((x) => x.number === e.ep) : e.air ? list.find((x) => x.aired === e.air) : undefined;
    if (!t) return e;
    const f = { ...e };
    if (generic(f.name) && !generic(t.name) && !dated(t.name)) f.name = t.name!;
    if (!f.overview && t.overview) f.overview = t.overview;
    if (!f.still && t.image) f.still = t.image;
    if (f.name !== e.name || f.overview !== e.overview || f.still !== e.still) f.tvdb = true;
    return f;
  });
}

// ---------- lists: shows in a TheTVDB category ----------
type TvdbSeries = { id: number; name: string };
const LANG: Record<string, string> = { en: 'eng', fi: 'fin', sv: 'swe', no: 'nor', da: 'dan', de: 'deu', fr: 'fra', es: 'spa', it: 'ita', pt: 'por', nl: 'nld',
  ja: 'jpn', ko: 'kor', zh: 'zho', hi: 'hin', pl: 'pol', tr: 'tur' };
const COUNTRY: Record<string, string> = { US: 'usa', GB: 'gbr', CA: 'can', AU: 'aus', IE: 'irl', NZ: 'nzl', FI: 'fin', SE: 'swe', NO: 'nor', DK: 'dnk', DE: 'deu',
  FR: 'fra', ES: 'esp', IT: 'ita', NL: 'nld', PT: 'prt', BR: 'bra', MX: 'mex', JP: 'jpn', KR: 'kor', CN: 'chn', IN: 'ind', PL: 'pol', TR: 'tur' };
const tmdbOf = new Map<number, string | null>();
export async function tvdbCategory(genre: number, o: { sort?: string; language?: string; country?: string; want: number }) {
  const by = o.sort === 'newest' ? 'firstAired&sortType=desc' : o.sort === 'oldest' ? 'firstAired&sortType=asc' : o.sort === 'az' ? 'name&sortType=asc' : 'score&sortType=desc';
  const where = `&lang=${LANG[o.language || 'en'] || 'eng'}${o.country && COUNTRY[o.country] ? `&country=${COUNTRY[o.country]}` : ''}`;
  const keys: string[] = [];
  for (let page = 0; page < 5 && keys.length < o.want; page++) {
    const r = await tvdb<{ data?: TvdbSeries[]; links?: { next?: string | null } }>(`/series/filter?genre=${genre}${where}&sort=${by}&page=${page}`);
    const series = r.data || [];
    for (let i = 0; i < series.length && keys.length < o.want; i += 10) {
      const found = await Promise.all(series.slice(i, i + 10).map((s) => keyOf(s.id)));
      keys.push(...found.filter((k): k is string => !!k));
    }
    if (!r.links?.next) break;
  }
  return keys.slice(0, o.want);
}
async function keyOf(id: number) {
  if (!tmdbOf.has(id)) {
    const show = (await tmdb<TmdbFind>(`/find/${id}?external_source=tvdb_id`).catch(() => null))?.tv_results?.[0];
    tmdbOf.set(id, show?.poster_path ? (await saveTitles([fromTmdb('tv')(show)]))[0].key : null);
  }
  return tmdbOf.get(id)!;
}

// ---------- episode places: an episode as another service numbers it, on TMDB's numbering ----------
export type EpisodeIds = { tvdb?: number | null; imdb?: string | null };
type TmdbEpisodeFind = { tv_episode_results?: { show_id: number; season_number: number; episode_number: number }[] };
const byIds = new Map<string, { show: number; se: number; ep: number } | null>();
// an episode by its own TheTVDB or IMDb id
export async function tmdbEpisode(ids: EpisodeIds) {
  const k = ids.tvdb ? `tvdb:${ids.tvdb}` : ids.imdb ? `imdb:${ids.imdb}` : '';
  if (!k) return null;
  if (!byIds.has(k)) {
    const r = await tmdb<TmdbEpisodeFind>(ids.tvdb ? `/find/${ids.tvdb}?external_source=tvdb_id` : `/find/${ids.imdb}?external_source=imdb_id`).catch(() => null);
    const e = r?.tv_episode_results?.[0];
    byIds.set(k, e ? { show: e.show_id, se: e.season_number, ep: e.episode_number } : null);
  }
  return byIds.get(k)!;
}
const tmdbShows = new Map<string, { at: number; counts: Map<number, number>; airs: Map<number, { ep: number; air: string | null }[]> }>();
async function tmdbShow(id: string) {
  let c = tmdbShows.get(id);
  if (!c || Date.now() - c.at > 6 * HOUR) {
    const d = await tmdb<{ seasons?: { season_number: number; episode_count: number }[] }>(`/tv/${id}`);
    c = { at: Date.now(), counts: new Map((d.seasons || []).map((x) => [x.season_number, x.episode_count])), airs: new Map() };
    tmdbShows.set(id, c);
  }
  return c;
}
async function tmdbAirs(id: string, season: number) {
  const c = await tmdbShow(id);
  if (!c.airs.has(season)) {
    const d = await tmdb<{ episodes?: { episode_number: number; air_date?: string | null }[] }>(`/tv/${id}/season/${season}`).catch(() => ({ episodes: [] }));
    c.airs.set(season, (d.episodes || []).map((e) => ({ ep: e.episode_number, air: e.air_date || null })));
  }
  return c.airs.get(season)!;
}
// a season and episode TMDB doesn't have, placed on the TMDB episode that aired the same day; null when it can't be placed
export async function tmdbPlace(tmdbId: string, se: number, ep: number) {
  const show = await tmdbShow(tmdbId);
  if ((show.counts.get(se) || 0) >= ep) return { se, ep };
  if (!tvdbOn()) return null;
  const id = await tvdbId(tmdbId);
  const aired = id ? (await tvdbSeason(id, se)).find((e) => e.number === ep)?.aired : null;
  if (!aired) return null;
  for (const n of [...show.counts.keys()].filter((x) => x > 0).sort((a, b) => Math.abs(a - se) - Math.abs(b - se))) {
    const hit = (await tmdbAirs(tmdbId, n)).find((e) => e.air === aired);
    if (hit) return { se: n, ep: hit.ep };
  }
  return null;
}

// ---------- a show's seasons as TheTVDB splits them, each episode at its TMDB place (matched by air date) ----------
const shiftDay = (day: string, d: number) => new Date(Date.parse(`${day}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
export type SplitSeason = { n: number; year: number | null; eps: { ep: number; se: number; tep: number }[] };
const splits = new Map<string, { at: number; value: SplitSeason[] | null }>();
// the split already worked out, if it is (undefined: not yet)
export function tvdbSplitKnown(tmdbId: string) {
  const c = splits.get(tmdbId);
  return c && Date.now() - c.at < 6 * HOUR ? c.value : undefined;
}
// strict (shows other than anime): only when every TheTVDB episode has its TMDB one
export async function tvdbSplit(tmdbId: string, strict = false) {
  const c = splits.get(tmdbId);
  if (c && Date.now() - c.at < 6 * HOUR) return c.value;
  let value: SplitSeason[] | null = null;
  const id = tvdbOn() ? await tvdbId(tmdbId) : null;
  if (id) {
    const all: TvdbEpisode[] = [];
    for (let page = 0; page < 20; page++) {
      const r = await tvdb<TvdbPage>(`/series/${id}/episodes/default?page=${page}`);
      all.push(...(r.data?.episodes || []).filter((e) => e.seasonNumber > 0 && e.aired));
      if (!r.links?.next) break;
    }
    const show = await tmdbShow(tmdbId), byDay = new Map<string, { se: number; tep: number }[]>();
    const counts = new Map<number, number>();
    for (const e of all) counts.set(e.seasonNumber, (counts.get(e.seasonNumber) || 0) + 1);
    const same = [...counts].every(([n, k]) => show.counts.get(n) === k) && [...show.counts].every(([n, k]) => n === 0 || counts.get(n) === k);
    if (same) { splits.set(tmdbId, { at: Date.now(), value: null }); return null; }
    for (const n of [...show.counts.keys()].filter((x) => x > 0).sort((a, b) => a - b))
      for (const e of await tmdbAirs(tmdbId, n)) if (e.air) (byDay.get(e.air) || byDay.set(e.air, []).get(e.air)!).push({ se: n, tep: e.ep });
    const out = new Map<number, SplitSeason>();
    let matched = 0, moved = 0;
    for (const e of all.sort((a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number)) {
      const p = [0, -1, 1].map((d) => byDay.get(shiftDay(e.aired!, d))).find((q) => q?.length)?.shift();
      if (!p) continue;
      matched++;
      if (p.se !== e.seasonNumber || p.tep !== e.number) moved++;
      const s = out.get(e.seasonNumber) || out.set(e.seasonNumber, { n: e.seasonNumber, year: Number(e.aired!.slice(0, 4)) || null, eps: [] }).get(e.seasonNumber)!;
      s.eps.push({ ep: e.number, se: p.se, tep: p.tep });
    }
    if (moved > 0 && (strict ? matched === all.length : matched >= all.length / 2)) value = [...out.values()];
  }
  splits.set(tmdbId, { at: Date.now(), value });
  return value;
}
