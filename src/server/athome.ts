// Latest releases: films out at home lately, in the ways a list asks for, each with the day it came out at home:
// - 4K disc, Blu-ray: blu-ray.com's feed (bluray.ts)
// - digital: TMDB's digital release date in the list's country (else the first anywhere)
// - only new films: first out in the year and a half before
// - streaming: streaming there now on a subscription (the given services, else any). TMDB can't say when a film arrived on a
//   service and many have no digital date there (anime films on Crunchyroll UK), so these are films made in the window and the
//   year and a half before, dated by their digital day there, else anywhere, else their first release (looked at again weekly).
// anime: TMDB asked for Japanese animation only. cinema: only films with a theatrical or limited release anywhere. Found days
// are kept (meta 'home-digital', the fallback in 'home-first'), and which films were in cinemas ('home-cinema').
import { discs } from './bluray';
import { inParallel } from './poller';
import { tmdb } from './sources';
import { metaGet, metaSet } from './store';
import { fromTmdb, saveTitles } from './titles';
import type { TmdbPage } from './types';

export type Home = 'uhd' | 'bluray' | 'digital' | 'streaming';
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
type Dates = { results?: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };

// a discover query's films over its first pages (most popular first, up to TMDB's last page), saved as titles: TMDB id -> title key
async function discover(path: string, pages: number) {
  const first = await tmdb<TmdbPage & { total_pages?: number }>(`${path}&page=1`).catch(() => null);
  const rest = await Promise.all(Array.from({ length: Math.min(pages, first?.total_pages || 1) - 1 }, (_, i) => tmdb<TmdbPage>(`${path}&page=${i + 2}`).then((d) => d.results, () => [])));
  const seen = new Set<number>(), films = [first?.results || [], ...rest].flat().filter((x) => !seen.has(x.id) && seen.add(x.id));
  const saved = await saveTitles(films.map(fromTmdb('movie')));
  return new Map(films.map((x, i) => [x.id, saved[i].key]));
}

export async function homeReleases(region: string, kinds: Home[], withinDays: number, cinema: boolean, providers: number[] = [], anime = false) {
  const now = Date.now(), since = now - withinDays * DAY, out = new Map<string, number>(), only = anime ? '&with_genres=16&with_original_language=ja' : '';
  const found: [string, number][] = [];   // title key, day at home
  const datesGot = new Map<number, Promise<Dates | null>>();
  const dates = (id: number) => { if (!datesGot.has(id)) datesGot.set(id, tmdb<Dates>(`/movie/${id}/release_dates`).catch(() => null)); return datesGot.get(id)!; };
  if (kinds.includes('uhd') || kinds.includes('bluray'))
    for (const d of await discs()) if (d.key && kinds.includes(d.uhd ? 'uhd' : 'bluray') && (d.year || 0) >= new Date(d.date - 548 * DAY).getUTCFullYear()) found.push([d.key, d.date]);
  const out4 = `/discover/movie?region=${region}&with_release_type=4&release_date.gte=${iso(since)}&release_date.lte=${iso(now)}&primary_release_date.gte=${iso(since - 548 * DAY)}&sort_by=popularity.desc&include_adult=false${only}`;
  const paths = [kinds.includes('digital') ? out4 : null, kinds.includes('streaming')
    ? `/discover/movie?watch_region=${region}&with_watch_monetization_types=flatrate${providers.length ? `&with_watch_providers=${providers.join('|')}` : ''}`
      + `&primary_release_date.gte=${iso(since - 548 * DAY)}&primary_release_date.lte=${iso(now)}&sort_by=popularity.desc&include_adult=false${only}` : null].filter((p) => p !== null);
  if (paths.length) {
    const digital = new Map((await Promise.all(paths.map((p) => discover(p, 25)))).flatMap((m) => [...m]));
    const known = (await metaGet<Record<string, number>>('home-digital')) || {};
    const first = (await metaGet<Record<string, { at: number; checked: number }>>('home-first')) || {};
    let added = false, addedFirst = false;
    await inParallel([...digital], 8, async ([id, key]) => {
      const k = `${id}:${region}`;
      if (!known[k] && !(first[k] && now - first[k].checked < 7 * DAY)) {
        const r = await dates(id), days = (c?: string, type?: number) => (r?.results || [])
          .filter((g) => !c || g.iso_3166_1 === c).flatMap((g) => g.release_dates).filter((d) => !type || d.type === type).map((d) => Date.parse(d.release_date)).filter((t) => t <= now);
        const at = Math.min(...(days(region, 4).length ? days(region, 4) : days(undefined, 4)));
        if (Number.isFinite(at)) { known[k] = at; added = true; delete first[k]; }
        else if (r) { const any = Math.min(...days()); if (Number.isFinite(any)) { first[k] = { at: any, checked: now }; addedFirst = true; } }
      }
      if (known[k]) found.push([key, known[k]]);
      else if (first[k] && kinds.includes('streaming')) found.push([key, first[k].at]);
    });
    if (added) await metaSet('home-digital', known);
    if (addedFirst || added) await metaSet('home-first', first);
  }
  let shown: Set<string> | null = null;
  if (cinema) {
    const was = (await metaGet<Record<string, boolean>>('home-cinema')) || {};
    let added = false;
    await inParallel([...new Set(found.filter(([, at]) => at >= since && at <= now).map(([key]) => key))], 8, async (key) => {
      const id = Number(key.split(':')[2]);
      if (!key.startsWith('tmdb:movie:') || was[id] !== undefined) return;
      const r = await dates(id);
      if (r) { was[id] = (r.results || []).some((g) => g.release_dates.some((d) => d.type === 2 || d.type === 3)); added = true; }
    });
    if (added) await metaSet('home-cinema', was);
    shown = new Set(found.map(([key]) => key).filter((key) => was[Number(key.split(':')[2])]));
  }
  for (const [key, at] of found) if ((!shown || shown.has(key)) && at >= since && at <= now && at > (out.get(key) ?? 0)) out.set(key, at);
  return out;
}
