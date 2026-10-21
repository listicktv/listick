// The Stats page (/api/stats): what you watched in a period (the last 12 months, a year, or all time), worked out from the
// History, your ratings and the titles: totals, plays by month (by year for all time), the year's days and streaks, the share
// of movies, shows and anime, genres, most watched, your ratings against TMDB's, rewatched films, and the day of the week and
// hour. Times are this server's (TZ). Plays brought in by the hundred at one minute (an import's bulk marks) count everywhere
// but the day and hour, which they'd pile onto one slot
import { q } from './db';
import { kitsu, tmdb } from './sources';
import type { KitsuOne, TitleType, TmdbDetails } from './types';

type Play = { key: string; season: number; at: number; title: string; type: TitleType; anime: number | null; poster: string | null;
  genres: string[] | null; runtime: number | null; rating: number | null };
type Kind = 'movie' | 'tv' | 'anime';
const kindOf = (p: { type: TitleType; anime: number | null }): Kind => (p.anime || p.type === 'anime' ? 'anime' : p.type === 'movie' ? 'movie' : 'tv');
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export type Period = '12m' | 'all' | `${number}`;
function periodRange(p: Period): [number, number] {
  const now = new Date();
  if (p === 'all') return [0, now.getTime()];
  if (/^\d{4}$/.test(p)) return [new Date(Number(p), 0, 1).getTime(), new Date(Number(p) + 1, 0, 1).getTime()];
  const from = new Date(now.getFullYear(), now.getMonth() - 12, 1);   // this month and the 12 before it
  return [from.getTime(), now.getTime()];
}

export async function statsOf(uid: string, period: Period) {
  const [from, to] = periodRange(period);
  const plays = await q.all<Play>(`select h.key, h.season, h.watched_at at, t.title, t.type, t.anime, t.poster, t.genres, t.runtime, t.rating
    from history h join titles t using (key) where h.user_id = ? and h.approx != 1 and h.watched_at >= ? and h.watched_at < ? order by h.watched_at`, uid, from, to);
  // the plays an import marked by the dozen at one minute
  const perMinute = new Map<number, number>();
  for (const p of plays) perMinute.set(Math.floor(p.at / 60000), (perMinute.get(Math.floor(p.at / 60000)) || 0) + 1);
  const timed = plays.filter((p) => (perMinute.get(Math.floor(p.at / 60000)) || 0) < 3);

  const kinds = { movie: 0, tv: 0, anime: 0 }, titles = new Set<string>(), days = new Map<string, number>();
  let minutes = 0, known = 0;
  for (const p of plays) {
    kinds[kindOf(p)]++; titles.add(p.key); const d = day(p.at); days.set(d, (days.get(d) || 0) + 1);
    if (p.runtime) { minutes += p.runtime; known++; }
  }
  // plays by month (by year for all time), each split by kind
  const byYear = period === 'all', buckets = new Map<string, { movie: number; tv: number; anime: number }>();
  if (!byYear) {
    const start = new Date(from), end = new Date(Math.min(to, Date.now()));
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d.setMonth(d.getMonth() + 1)) buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, { movie: 0, tv: 0, anime: 0 });
  }
  for (const p of plays) {
    const d = new Date(p.at), b = byYear ? String(d.getFullYear()) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(b)) buckets.set(b, { movie: 0, tv: 0, anime: 0 });
    buckets.get(b)![kindOf(p)]++;
  }
  // streaks: days in a row with a play (the current one counts today or yesterday)
  const sorted = [...days.keys()].sort();
  let longest = 0, run = 0, prev = 0, busiest: [string, number] | null = null;
  for (const d of sorted) {
    const t = new Date(`${d}T12:00:00`).getTime();
    run = prev && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = t;
    if (!busiest || days.get(d)! > busiest[1]) busiest = [d, days.get(d)!];
  }
  let current = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) { if (days.has(day(d.getTime()))) current++; else if (current || day(d.getTime()) !== day(Date.now())) break; }
  // genres: titles of each kind in each, the top 8
  const gen = new Map<string, { movie: Set<string>; tv: Set<string>; anime: Set<string> }>();
  for (const p of plays) for (const g of Array.isArray(p.genres) ? p.genres : []) {
    if (!gen.has(g)) gen.set(g, { movie: new Set(), tv: new Set(), anime: new Set() });
    gen.get(g)![kindOf(p)].add(p.key);
  }
  const genres = [...gen].map(([name, k]) => ({ name, movie: k.movie.size, tv: k.tv.size, anime: k.anime.size }))
    .sort((a, b) => b.movie + b.tv + b.anime - (a.movie + a.tv + a.anime)).slice(0, 8);
  // most watched shows and anime (episodes), and films watched more than once
  const count = (list: Play[]) => { const m = new Map<string, { key: string; title: string; poster: string | null; kind: Kind; n: number }>();
    for (const p of list) { const e = m.get(p.key) || { key: p.key, title: p.title, poster: p.poster, kind: kindOf(p), n: 0 }; e.n++; m.set(p.key, e); }
    return [...m.values()].sort((a, b) => b.n - a.n); };
  const top = count(plays.filter((p) => p.type !== 'movie')).slice(0, 6);
  const again = count(plays.filter((p) => p.type === 'movie')).filter((x) => x.n > 1).slice(0, 3);
  // your ratings in the period (by when you rated), against TMDB's for the titles
  const rs = await q.all<{ key: string; rating: number; title: string; theirs: number | null }>(`select r.key, r.rating, t.title, t.rating theirs from ratings r join titles t using (key)
    where r.user_id = ? and r.season < 0 and r.rated_at >= ? and r.rated_at < ?`, uid, from, to);
  const hist: Record<number, number> = {};
  for (const r of rs) hist[Math.round(r.rating)] = (hist[Math.round(r.rating)] || 0) + 1;
  const both = rs.filter((r) => r.theirs), diff = (r: (typeof rs)[number]) => r.rating - r.theirs!;
  const pick = (list: typeof rs) => list.slice(0, 3).map((r) => ({ key: r.key, title: r.title, mine: r.rating, theirs: Math.round(r.theirs! * 10) / 10 }));
  // day of the week (Monday first) and hour, from the timed plays
  const weekdays = [0, 0, 0, 0, 0, 0, 0], hours = Array(24).fill(0);
  // an import's plays given a time of their own stand exactly on the hour (Trakt's dates at 18:00): their day counts, not their hour
  for (const p of timed) { const d = new Date(p.at); weekdays[(d.getDay() + 6) % 7]++; if (p.at % 3600000) hours[d.getHours()]++; }

  return {
    period, from, to: Math.min(to, Date.now()),
    totals: { plays: plays.length, episodes: kinds.tv + kinds.anime, movies: kinds.movie, titles: titles.size, days: days.size,
      span: Math.max(1, Math.round((Math.min(to, Date.now()) - (plays[0]?.at ?? from)) / 86400000)),
      ratings: rs.length, avg: rs.length ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10 : null,
      // hours from the plays whose runtime is known, scaled up to all of them (null until most are known)
      hours: known && known >= plays.length * 0.6 ? Math.round((minutes / known) * plays.length / 60) : null },
    kinds, months: [...buckets].map(([at, k]) => ({ at, ...k })).sort((a, b) => a.at.localeCompare(b.at)), byYear,
    days: Object.fromEntries(days), streaks: { longest, current, busiest: busiest && { day: busiest[0], plays: busiest[1] } },
    genres, top, again,
    ratings: { hist, vs: both.length ? { n: both.length, avg: Math.round((both.reduce((a, r) => a + diff(r), 0) / both.length) * 10) / 10,
      higher: both.filter((r) => diff(r) > 0.5).length, lower: both.filter((r) => diff(r) < -0.5).length,
      more: pick([...both].sort((a, b) => diff(b) - diff(a)).filter((r) => diff(r) > 0.5)), less: pick([...both].sort((a, b) => diff(a) - diff(b)).filter((r) => diff(r) < -0.5)) } : null },
    weekdays, hours,
    years: (await q.all<{ y: number }>(`select distinct extract(year from to_timestamp(watched_at / 1000))::int y from history where user_id = ? and approx != 1 order by y desc`, uid)).map((r) => r.y),
  };
}

// runtimes for the titles you've watched (Stats' hours): a film's, or a show's episode, from TMDB or Kitsu; 0 when there's none.
// A few a second, the ones without first
export async function fillRuntimes(limit = 1000) {
  const keys = (await q.all<{ key: string }>(`select distinct t.key from titles t join history h using (key) where t.runtime is null limit ?`, limit)).map((r) => r.key);
  let n = 0;
  for (const key of keys) {
    const [src, type, id] = key.split(':');
    let min = 0;
    if (src === 'tmdb') {
      const d = await tmdb<TmdbDetails>(`/${type}/${id}`).catch(() => null);
      if (!d) continue;
      min = d.runtime || d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || d.next_episode_to_air?.runtime || 0;
    } else {
      const a = await kitsu<KitsuOne>(`/anime/${id}`).catch(() => null);
      if (!a) continue;
      min = a.data.attributes.episodeLength || 0;
    }
    await q.run('update titles set runtime = ? where key = ?', min, key); n++;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (n) console.log(`runtimes: ${n} titles`);
}
