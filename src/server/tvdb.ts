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
const generic = (n: string | null | undefined) => !n || /^(episode|episodio|épisode|folge|aflevering)\s*#?\d+$/i.test(n.trim()) || /^\d+$/.test(n.trim());
const dated = (n: string | null | undefined) => !!n && /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(n.trim());

// a season's episodes with their gaps filled: matched by number when both list the same count, else by air date
export async function fillFromTvdb(tmdbId: string, season: number, eps: Episode[]) {
  if (!tvdbOn() || !eps.some((e) => generic(e.name) || !e.overview || !e.still)) return eps;
  const id = await tvdbId(tmdbId);
  if (!id) return eps;
  const list: TvdbEpisode[] = [];
  for (let page = 0; page < 10; page++) {
    const r = await tvdb<TvdbPage>(`/series/${id}/episodes/default?page=${page}&season=${season}`);
    list.push(...(r.data?.episodes || []).filter((e) => e.seasonNumber === season));
    if (!r.links?.next) break;
  }
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
