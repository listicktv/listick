// Your own data: everything Listick keeps about you, as one JSON file (Account › Your data › Export). Connections show only
// whether they are on: session keys and tokens stay out of the file.
import { q } from './db';
import { getUser } from './store';

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
// a play or rating of a season or an episode says which; one of the whole title has no episode field
const episodeOf = (season: number, episode: number) => (season < 0 ? {} : { episode: { season, episode: episode < 0 ? null : episode } });

export async function exportOf(uid: string) {
  const u = (await getUser(uid))!;
  type H = { key: string; title: string | null; type: string | null; year: number | null; season: number; episode: number; watched_at: number; approx: number; source: string };
  const history = await q.all<H>(`select h.key, t.title, t.type, t.year, h.season, h.episode, h.watched_at, h.approx, h.source
    from history h left join titles t using (key) where h.user_id = ? order by h.watched_at`, uid);
  type R = { key: string; title: string | null; season: number; episode: number; rating: number; rated_at: number; source: string };
  const ratings = await q.all<R>(`select r.key, t.title, r.season, r.episode, r.rating, r.rated_at, r.source
    from ratings r left join titles t using (key) where r.user_id = ? order by r.rated_at`, uid);
  const watchlist = await q.all<{ key: string; title: string | null; added_at: number }>(`select w.key, t.title, w.added_at
    from watchlist w left join titles t using (key) where w.user_id = ? order by w.added_at`, uid);
  type P = { key: string; season: number; episode: number; progress: number; paused_at: number; source: string };
  const playback = await q.all<P>('select key, season, episode, progress, paused_at, source from playback where user_id = ? order by paused_at', uid);
  return {
    format: 'listick-export', version: 1, exportedAt: new Date().toISOString(),
    account: { username: u.name, name: u.first_name, email: u.email, createdAt: iso(u.created_at) },
    connections: { stremio: !!u.stremio_key },
    // approx: 1 = the date is unknown (kept on the release day), 2 = the time is estimated
    history: history.map((h) => ({ key: h.key, title: h.title, type: h.type, year: h.year, ...episodeOf(h.season, h.episode),
      watchedAt: iso(h.watched_at), approx: h.approx, source: h.source })),
    ratings: ratings.map((r) => ({ key: r.key, title: r.title, ...episodeOf(r.season, r.episode), rating: r.rating,
      ratedAt: iso(r.rated_at), source: r.source })),
    watchlist: watchlist.map((w) => ({ key: w.key, title: w.title, addedAt: iso(w.added_at) })),
    playback: playback.map((x) => ({ key: x.key, ...episodeOf(x.season, x.episode), progress: x.progress,
      pausedAt: iso(x.paused_at), source: x.source })),
  };
}
