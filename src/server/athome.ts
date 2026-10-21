// Latest releases: films out at home lately, in the ways a list asks for, each with the day it came out at home:
// - 4K disc, Blu-ray: blu-ray.com's feed (bluray.ts)
// - digital: TMDB's digital release date in the list's country (else the first anywhere)
// - streaming: streaming there now on a subscription (the given services, else any). TMDB can't say when a film arrived on a
//   service and many have no digital date there (anime films on Crunchyroll UK), so these are films made in the window and the
//   year and a half before, dated by their digital day there, else anywhere, else their first release (looked at again weekly).
// anime: TMDB asked for Japanese animation only. cinema: only films in cinemas there in the year and a half before. Found days
// are kept (meta 'home-digital', the fallback in 'home-first').
import { discs } from './bluray';
import { tmdb } from './sources';
import { metaGet, metaSet } from './store';
import { fromTmdb, saveTitles } from './titles';
import type { TmdbPage } from './types';

export type Home = 'uhd' | 'bluray' | 'digital' | 'streaming';
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
type Dates = { results?: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };

// a discover query's films over its first pages (most popular first), saved as titles: TMDB id -> title key
async function discover(path: string, pages: number) {
  const all = await Promise.all(Array.from({ length: pages }, (_, i) => tmdb<TmdbPage>(`${path}&page=${i + 1}`).then((d) => d.results, () => [])));
  const seen = new Set<number>(), films = all.flat().filter((x) => !seen.has(x.id) && seen.add(x.id));
  const saved = await saveTitles(films.map(fromTmdb('movie')));
  return new Map(films.map((x, i) => [x.id, saved[i].key]));
}

export async function homeReleases(region: string, kinds: Home[], withinDays: number, cinema: boolean, providers: number[] = [], anime = false) {
  const now = Date.now(), since = now - withinDays * DAY, out = new Map<string, number>(), only = anime ? '&with_genres=16&with_original_language=ja' : '';
  const take = (key: string | null | undefined, at: number) => { if (key && at >= since && at <= now && at > (out.get(key) ?? 0)) out.set(key, at); };
  // the films in cinemas there (theatrical or limited) in the year and a half before, the most popular 300
  const films = cinema ? new Set((await discover(`/discover/movie?region=${region}&with_release_type=2|3&release_date.gte=${iso(now - 548 * DAY)}&release_date.lte=${iso(now)}&sort_by=popularity.desc&include_adult=false${only}`, 15)).values()) : null;
  const ok = (key: string | null | undefined) => !!key && (!films || films.has(key));
  if (kinds.includes('uhd') || kinds.includes('bluray'))
    for (const d of await discs()) if (ok(d.key) && kinds.includes(d.uhd ? 'uhd' : 'bluray')) take(d.key, d.date);
  const out4 = `/discover/movie?region=${region}&with_release_type=4&release_date.gte=${iso(since)}&release_date.lte=${iso(now)}&sort_by=popularity.desc&include_adult=false${only}`;
  const paths = [kinds.includes('digital') ? out4 : null, kinds.includes('streaming')
    ? `/discover/movie?watch_region=${region}&with_watch_monetization_types=flatrate${providers.length ? `&with_watch_providers=${providers.join('|')}` : ''}`
      + `&primary_release_date.gte=${iso(since - 548 * DAY)}&primary_release_date.lte=${iso(now)}&sort_by=popularity.desc&include_adult=false${only}` : null].filter((p) => p !== null);
  if (paths.length) {
    const digital = new Map((await Promise.all(paths.map((p) => discover(p, 10)))).flatMap((m) => [...m]));
    const known = (await metaGet<Record<string, number>>('home-digital')) || {};
    const first = (await metaGet<Record<string, { at: number; checked: number }>>('home-first')) || {};
    let added = false, addedFirst = false;
    for (const [id, key] of digital) {
      if (!ok(key)) continue;
      const k = `${id}:${region}`;
      if (!known[k] && !(first[k] && now - first[k].checked < 7 * DAY)) {
        const r = await tmdb<Dates>(`/movie/${id}/release_dates`).catch(() => null), days = (c?: string, type?: number) => (r?.results || [])
          .filter((g) => !c || g.iso_3166_1 === c).flatMap((g) => g.release_dates).filter((d) => !type || d.type === type).map((d) => Date.parse(d.release_date)).filter((t) => t <= now);
        const at = Math.min(...(days(region, 4).length ? days(region, 4) : days(undefined, 4)));
        if (Number.isFinite(at)) { known[k] = at; added = true; delete first[k]; }
        else if (r) { const any = Math.min(...days()); if (Number.isFinite(any)) { first[k] = { at: any, checked: now }; addedFirst = true; } }
      }
      if (known[k]) take(key, known[k]);
      else if (first[k] && kinds.includes('streaming')) take(key, first[k].at);
    }
    if (added) await metaSet('home-digital', known);
    if (addedFirst || added) await metaSet('home-first', first);
  }
  return out;
}
