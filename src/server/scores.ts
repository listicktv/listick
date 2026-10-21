// Other sources' scores for smart lists: IMDb, Rotten Tomatoes and Metacritic (through OMDb), MyAnimeList and Kitsu (anime, by
// Fribb's links), checked title by title and kept in title_scores (a score, or null: checked, the source has none) for 30 days.
// TMDB can't filter on them, so a list with these floors keeps a pool of TMDB candidates (meta list-pool:<id>) and takes those
// that pass; the worker's scores job checks the rest a few at a time, within OMDb's daily allowance, and picks the lists again
import { omdbFor } from './details';
import { q } from './db';
import { fribb, loadFribb } from './mapping';
import { OMDB_DAILY, kitsu, localDay, mal, tmdb } from './sources';
import type { KitsuOne } from './types';
import { HOUR, env } from './util';

export type Src = 'imdb' | 'rt' | 'mc' | 'mal' | 'kitsu';
const SRC: Src[] = ['imdb', 'rt', 'mc', 'mal', 'kitsu'];
// a list's floors (imdb and mal 0-10, rt and kitsu in %, mc 0-100), whether a title must pass all of them or any, and what a
// source with no score for a title counts as
export type ScoreRule = { ext?: Partial<Record<Src, number>>; meet?: 'all' | 'any'; missing?: 'out' | 'keep' };
const OMDB: Src[] = ['imdb', 'rt', 'mc'];
const STALE = 30 * 24 * HOUR;
// the sources this instance can check (OMDb and MyAnimeList need their keys)
const sourcesOn = (): Record<Src, boolean> => ({ imdb: !!env('OMDB_API_KEY'), rt: !!env('OMDB_API_KEY'), mc: !!env('OMDB_API_KEY'), mal: !!env('MAL_CLIENT_ID'), kitsu: true });
export const floorsOf = (r: ScoreRule) => Object.entries(r.ext || {}).filter(([s, v]) => SRC.includes(s as Src) && typeof v === 'number' && v > 0) as [Src, number][];

type Known = Map<string, Partial<Record<Src, number | null>>>;
export async function known(keys: string[]): Promise<Known> {
  const out: Known = new Map();
  if (!keys.length) return out;
  for (const r of await q.all<{ key: string; source: Src; score: number | null; checked_at: number }>('select key, source, score, checked_at from title_scores where key = any(?)', keys))
    if (Date.now() - r.checked_at < STALE) (out.get(r.key) || out.set(r.key, {}).get(r.key)!)[r.source] = r.score;
  return out;
}
// pass, fail, or pending (a source not checked yet decides it)
export function verdict(s: Partial<Record<Src, number | null>> | undefined, r: ScoreRule): 'pass' | 'fail' | 'pending' {
  const each = floorsOf(r).map(([src, floor]) => {
    const v = s?.[src];
    return v === undefined ? 'unknown' : v === null ? (r.missing === 'keep' ? 'pass' : 'fail') : v >= floor ? 'pass' : 'fail';
  });
  if (r.meet === 'any') return each.includes('pass') ? 'pass' : each.includes('unknown') ? 'pending' : 'fail';
  return each.includes('fail') ? 'fail' : each.includes('unknown') ? 'pending' : 'pass';
}

const save = (key: string, src: Src, score: number | null) => q.run(`insert into title_scores (key, source, score, checked_at) values (?, ?, ?, ?)
  on conflict (key, source) do update set score = excluded.score, checked_at = excluded.checked_at`, key, src, score, Date.now());
const num = (v: string | null | undefined) => { const n = v ? parseFloat(v) : NaN; return Number.isFinite(n) ? n : null; };
// one title's scores from the sources asked for (a TMDB title; anime ones by Fribb's Kitsu and MyAnimeList ids)
async function check(key: string, srcs: Src[]) {
  const [src, type, id] = key.split(':');
  if (src !== 'tmdb' || (type !== 'movie' && type !== 'tv')) { for (const s of srcs) await save(key, s, null); return; }
  if (srcs.some((s) => OMDB.includes(s))) {
    const imdb = (await tmdb<{ imdb_id?: string | null }>(`/${type}/${id}/external_ids`)).imdb_id;
    const o = imdb ? await omdbFor(imdb) : null;
    await save(key, 'imdb', num(o?.imdb)); await save(key, 'rt', num(o?.rt)); await save(key, 'mc', num(o?.mc));
  }
  if (srcs.includes('mal') || srcs.includes('kitsu')) {
    await loadFribb();
    const entries = type === 'tv' ? [...(fribb.byTmdb.get(Number(id)) || [])].sort((a, b) => (a.season || 99) - (b.season || 99) || a.offset - b.offset) : [];
    const k = type === 'tv' ? entries[0]?.kitsu : fribb.byMovie.get(Number(id));
    const m = type === 'tv' ? entries.find((e) => e.mal)?.mal : k ? fribb.map.get(k)?.mal : null;
    if (srcs.includes('kitsu')) await save(key, 'kitsu', k ? num((await kitsu<KitsuOne>(`/anime/${k}`)).data.attributes.averageRating as string | null | undefined) : null);
    if (srcs.includes('mal')) await save(key, 'mal', m && env('MAL_CLIENT_ID') ? (await mal<{ mean?: number }>(`/anime/${m}?fields=mean`)).mean ?? null : null);
  }
}

// the builder's preview: its first unknown candidates checked in the background (one run at a time, 40 titles, OMDb within the
// same allowance), so the count moves before the worker's next round
let warming = false;
export function warm(pool: string[], r: ScoreRule) {
  const floors = floorsOf(r), on = sourcesOn();
  if (warming || !floors.length) return;
  warming = true;
  void (async () => {
    try {
      const used = (await q.one<{ n: number }>("select coalesce(sum(calls), 0)::int n from api_calls where day = ? and service = 'omdb'", localDay()))!.n;
      let omdbLeft = Math.max(0, Math.floor(OMDB_DAILY * 0.7) - used);
      const have = await known(pool);
      for (const key of pool.slice(0, 120).filter((k) => floors.some(([s]) => on[s] && have.get(k)?.[s] === undefined)).slice(0, 40)) {
        const srcs = floors.map(([s]) => s).filter((s) => on[s] && (!OMDB.includes(s) || omdbLeft > 0));
        if (!srcs.length) break;
        await check(key, srcs).catch((e) => console.error(`scores ${key}: ${e}`));
        if (srcs.some((s) => OMDB.includes(s))) omdbLeft--;
      }
    } finally { warming = false; }
  })();
}
// the worker: the lists with floors, their candidates' unknown scores checked (OMDb up to 70% of its day's allowance, the rest
// 120 titles a run), then those lists picked again
export async function checkDue(reselect: (listId: string) => Promise<unknown>) {
  const lists = await q.all<{ id: string; filters: ScoreRule }>("select id, filters from lists where kind = 'smart' and filters->'ext' is not null");
  const work = new Map<string, Set<Src>>(), touched = new Map<string, Set<string>>();
  for (const l of lists) {
    const floors = floorsOf(l.filters), on = sourcesOn();
    if (!floors.length) continue;
    const pool = (await q.one<{ v: { keys: string[] } }>('select v from meta where k = ?', `list-pool:${l.id}`))?.v.keys || [], have = await known(pool);
    for (const key of pool) for (const [s] of floors) if (on[s] && have.get(key)?.[s] === undefined) {
      (work.get(key) || work.set(key, new Set()).get(key)!).add(s);
      (touched.get(l.id) || touched.set(l.id, new Set()).get(l.id)!).add(key);
    }
  }
  if (!work.size) return;
  const used = (await q.one<{ n: number }>("select coalesce(sum(calls), 0)::int n from api_calls where day = ? and service = 'omdb'", localDay()))!.n;
  let omdbLeft = Math.max(0, Math.floor(OMDB_DAILY * 0.7) - used), others = 120, done = 0;
  for (const [key, srcs] of work) {
    const all = [...srcs], needsOmdb = all.some((s) => OMDB.includes(s));
    const now = all.filter((s) => (OMDB.includes(s) ? omdbLeft > 0 : others > 0));
    if (!now.length) continue;
    try { await check(key, now); done++; } catch (e) { console.error(`scores ${key}: ${e}`); }
    if (needsOmdb && now.some((s) => OMDB.includes(s))) omdbLeft--;
    if (now.some((s) => !OMDB.includes(s))) others--;
    if (omdbLeft <= 0 && others <= 0) break;
  }
  for (const id of touched.keys()) await reselect(id).catch((e) => console.error(`list ${id}: ${e}`));
  if (done) console.log(`scores: ${done} titles checked for ${touched.size} lists`);
}
