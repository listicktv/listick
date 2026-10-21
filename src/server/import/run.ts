// Imports: a user's history, ratings and Plan to watch brought in from another service, queued in the imports table and run
// by the worker one at a time. Each source hands over references to titles (a TMDB, Kitsu, MAL or IMDb id, or a film's name
// and year); they're resolved here to Listick keys, anime episodes placed on their TMDB show like tracking places them.
// Plays go through addPlay (a play already recorded within its window isn't added again); ratings and the watchlist never
// overwrite what the user has. An uploaded file's entries live in the import's payload only until the run ends.
import { q } from '../db';
import { canonEp, kitsuOfMal, kitsuTitle, resolve, tmdbTitle } from '../mapping';
import { addPlay, collapseDoubles } from '../plays';
import { tmdb } from '../sources';
import { getTitle } from '../titles';
import type { TmdbPage } from '../types';
import { alert } from '../alert';
import { msg } from '../util';
import type { LetterboxdFilm, MalEntry } from './files';
import { simklFileImport, type SimklData } from './simkl';
import { traktFileImport, type TraktData } from './trakt';

type Source = 'trakt' | 'simkl' | 'letterboxd' | 'mal' | 'anilist' | 'kitsu';
// a title as a source knows it
export type Ref = { tmdb?: { type: 'movie' | 'tv'; id: number }; kitsu?: number; mal?: number; imdb?: string; film?: { name: string; year: number | null } };
type Counts = { plays: number; ratings: number; watchlist: number; unmatched: number; seen: number };
export type Ctx = {
  uid: string;
  play: (ref: Ref, se: number, ep: number, at: number, approx?: number) => Promise<void>;
  rate: (ref: Ref, se: number, ep: number, rating: number, at: number) => Promise<void>;
  want: (ref: Ref, at: number) => Promise<void>;
  // a film's release day at 19:00 UTC, where an import knows it was watched but not when (approx 1, like a first rating's)
  released: (ref: Ref) => Promise<number | null>;
};
type Payload = { films?: LetterboxdFilm[]; anime?: MalEntry[]; trakt?: TraktData; simkl?: SimklData };

// ---------- the queue ----------
export async function queueImport(uid: string, source: Source, payload: Payload) {
  const r = await q.one<{ id: number }>('insert into imports (user_id, source, payload, created_at) values (?, ?, ?::jsonb, ?) returning id', uid, source, JSON.stringify(payload), Date.now());
  return r!.id;
}
type ImportRun = { id: number; source: Source; status: 'queued' | 'running' | 'done' | 'failed'; counts: Partial<Counts>; error: string | null; created: number; finished: number | null };
export const importsOf = (uid: string) => q.all<ImportRun>(`select id, source, status, counts, error, created_at created, finished_at finished
  from imports where user_id = ? order by created_at desc limit 10`, uid);

// the oldest queued import, taken by this worker (another one would skip it), run to its end
export async function runNextImport() {
  const job = await q.one<{ id: number; user_id: string; source: Source; payload: Payload | null }>(`update imports set status = 'running', started_at = ?
    where id = (select id from imports where status = 'queued' order by created_at limit 1 for update skip locked) returning id, user_id, source, payload`, Date.now());
  if (!job) return false;
  const counts: Counts = { plays: 0, ratings: 0, watchlist: 0, unmatched: 0, seen: 0 };
  let saved = 0;
  const progress = async (force = false) => {
    if (!force && counts.seen - saved < 50) return;
    saved = counts.seen;
    await q.run('update imports set counts = ?::jsonb where id = ?', JSON.stringify(counts), job.id);
  };
  try {
    const ctx = context(job.user_id, job.source, counts, progress);
    const p = job.payload || {};
    if (job.source === 'trakt') await traktFileImport(ctx, p.trakt!);
    else if (job.source === 'simkl') await simklFileImport(ctx, p.simkl!);
    else if (job.source === 'letterboxd') await letterboxdImport(ctx, p.films || []);
    // AniList (its list as MyAnimeList XML) and Kitsu (its library, read by username) come as MyAnimeList entries
    else if (job.source === 'mal' || job.source === 'anilist' || job.source === 'kitsu') await malImport(ctx, p.anime || []);
    await collapseDoubles();
    await q.run(`update imports set status = 'done', counts = ?::jsonb, payload = null, finished_at = ? where id = ?`, JSON.stringify(counts), Date.now(), job.id);
    console.log(`import: ${job.source} for ${job.user_id}: ${counts.plays} plays, ${counts.ratings} ratings, ${counts.watchlist} saved, ${counts.unmatched} unmatched`);
  } catch (e) {
    await q.run(`update imports set status = 'failed', counts = ?::jsonb, error = ?, payload = null, finished_at = ? where id = ?`, JSON.stringify(counts), msg(e), Date.now(), job.id);
    console.error(`import: ${job.source} for ${job.user_id} failed: ${msg(e)}`);
    await alert(`import failed: ${job.source}`, msg(e));
  }
  return true;
}
// an import still running when its worker stopped starts again (plays already in aren't added twice)
export const requeueStuck = () => q.run(`update imports set status = 'queued' where status = 'running' and started_at < ?`, Date.now() - 60000);

// ---------- resolving titles ----------
function context(uid: string, source: Source, counts: Counts, progress: (force?: boolean) => Promise<void>): Ctx {
  const keys = new Map<string, Promise<string | null>>();
  const releases = new Map<string, number | null>();
  // the Listick key of a reference: TMDB ids as they are, anime by its Kitsu entry, films by name and year at TMDB
  const keyOf = (ref: Ref) => {
    const id = JSON.stringify(ref);
    if (!keys.has(id)) keys.set(id, (async () => {
      if (ref.kitsu) return kitsuTitle(ref.kitsu);
      if (ref.mal) { const k = await kitsuOfMal(ref.mal); if (k) return kitsuTitle(k); }
      if (ref.tmdb) return tmdbTitle(ref.tmdb.type, ref.tmdb.id);
      if (ref.imdb) return resolve({ imdb: ref.imdb });
      if (ref.film) {
        const find = (year: number | null) => tmdb<TmdbPage>(`/search/movie?query=${encodeURIComponent(ref.film!.name)}${year ? `&year=${year}` : ''}&include_adult=false`);
        const hit = (await find(ref.film.year).catch(() => null))?.results?.[0] || (ref.film.year ? (await find(null).catch(() => null))?.results?.[0] : undefined);
        if (!hit) return null;
        if (hit.release_date) releases.set(`tmdb:movie:${hit.id}`, new Date(`${hit.release_date}T19:00:00Z`).getTime());
        return tmdbTitle('movie', hit.id);
      }
      return null;
    })().catch(() => null));
    return keys.get(id)!;
  };
  // where a play or rating of an episode sits: Kitsu entries count their own episodes under season 1, placed on TMDB
  const place = async (ref: Ref, se: number, ep: number) => {
    const key = await keyOf(ref);
    if (!key) { counts.unmatched++; return null; }
    return key.startsWith('kitsu:') ? canonEp(key, se < 0 ? se : 1, ep) : { key, se, ep };
  };
  const step = async () => { counts.seen++; await progress(); };
  return {
    uid,
    async play(ref, se, ep, at, approx = 0) {
      const p = await place(ref, se, ep);
      if (p) counts.plays += await addPlay(uid, p.key, p.se, p.ep, at, source, approx);
      await step();
    },
    async rate(ref, se, ep, rating, at) {
      const p = await place(ref, se, ep);
      if (p) counts.ratings += (await q.run(`insert into ratings (user_id, key, season, episode, rating, rated_at, source) values (?, ?, ?, ?, ?, ?, ?)
        on conflict do nothing`, uid, p.key, p.se, p.ep, Math.round(Math.min(10, Math.max(1, rating)) * 10) / 10, at, source)).changes;
      await step();
    },
    async want(ref, at) {
      const key = await keyOf(ref);
      if (!key) counts.unmatched++;
      else counts.watchlist += (await q.run('insert into watchlist (user_id, key, added_at) values (?, ?, ?) on conflict do nothing', uid, key, at)).changes;
      await step();
    },
    async released(ref) {
      const key = await keyOf(ref);
      if (!key) { counts.unmatched++; return null; }
      if (!releases.has(key) && key.startsWith('kitsu:')) {
        // a Kitsu entry: the start of its year is as close as its stored title gets
        const year = (await getTitle(key))?.year;
        releases.set(key, year ? Date.UTC(year, 0, 1, 19) : null);
      }
      if (!releases.has(key)) {
        const [, type, id] = key.split(':');
        const d = await tmdb<{ release_date?: string; first_air_date?: string }>(`/${type}/${id}`).catch(() => null);
        const day = d?.release_date || d?.first_air_date;
        releases.set(key, day ? new Date(`${day}T19:00:00Z`).getTime() : null);
      }
      return releases.get(key) ?? null;
    },
  };
}

// ---------- files ----------
// Letterboxd: each diary viewing on its day (the time unknown: approx 2), films marked watched with no diary entry once on
// their release day (approx 1), ratings at their date, the watchlist
const evening = (day: string) => new Date(`${day}T20:00:00Z`).getTime();
async function letterboxdImport(ctx: Ctx, films: LetterboxdFilm[]) {
  for (const f of films) {
    const ref: Ref = { film: { name: f.name, year: f.year } };
    for (const v of f.viewings) await ctx.play(ref, -1, -1, evening(v.date), 2);
    if (f.watched && !f.viewings.length) { const at = await ctx.released(ref); if (at && at < Date.now()) await ctx.play(ref, -1, -1, at, 1); }
    if (f.rating) await ctx.rate(ref, -1, -1, f.rating, f.ratedAt ? evening(f.ratedAt) : Date.now());
    if (f.want !== null) await ctx.want(ref, f.want ? evening(f.want) : Date.now());
  }
}
// MyAnimeList: the episodes watched, one play each a minute apart ending on the finish date (else the start date; with
// neither, the date is unknown: approx 1 on the start of the title's year), the score, Plan to Watch
async function malImport(ctx: Ctx, anime: MalEntry[]) {
  for (const a of anime) {
    const ref: Ref = a.kitsu ? { kitsu: a.kitsu } : { mal: a.mal };
    if (/plan to watch/i.test(a.status)) await ctx.want(ref, Date.now());
    const day = a.finished || a.started;
    for (let ep = 1; ep <= a.watched; ep++) {
      const at = day ? evening(day) - (a.watched - ep) * 60000 : null;
      if (at) await ctx.play(ref, 1, ep, at, 2);
      else { const r = await ctx.released(ref); if (r) await ctx.play(ref, 1, ep, r - (a.watched - ep) * 60000, 1); }
    }
    if (a.score) await ctx.rate(ref, -1, -1, a.score, day ? evening(day) : Date.now());
  }
}
