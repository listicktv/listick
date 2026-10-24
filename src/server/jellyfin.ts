// Jellyfin: its Webhook plugin (a Generic destination with Listick's template) sends what starts playing, its progress, and a
// movie or episode played to the end or marked played (a play); the episode found by its own TheTVDB or IMDb id, else by its
// show's name and number
import { resolve } from './mapping';
import { addPlay } from './plays';
import { saveResume } from './resume';
import { tmdb } from './sources';
import { getState, setState } from './store';
import { fromTmdb, saveTitles } from './titles';
import { tmdbEpisode, tmdbPlace } from './tvdb';
import type { TmdbItem } from './types';

type Hook = Partial<Record<'event' | 'type' | 'name' | 'series' | 'year' | 'season' | 'episode' | 'episodeEnd' | 'tmdb' | 'imdb' | 'tvdb' | 'done' | 'played'
  | 'position' | 'runtime', string>>;
export type Now = { key: string; se: number; ep: number; pct: number | null; at: number; until: number };
export const JELLYFIN_TEMPLATE = JSON.stringify({ event: '{{NotificationType}}', type: '{{ItemType}}', name: '{{Name}}', series: '{{SeriesName}}', year: '{{Year}}',
  season: '{{SeasonNumber}}', episode: '{{EpisodeNumber}}', episodeEnd: '{{EpisodeNumberEnd}}', tmdb: '{{Provider_tmdb}}', imdb: '{{Provider_imdb}}',
  tvdb: '{{Provider_tvdb}}', done: '{{PlayedToCompletion}}', played: '{{Played}}', position: '{{PlaybackPositionTicks}}', runtime: '{{RunTimeTicks}}' }, null, 2);

const yes = (v?: string) => /^true$/i.test((v || '').trim());
const num = (v?: string) => (/^\d+$/.test((v || '').trim()) ? Number(v) : null);
const imdbOf = (v?: string) => (/^tt\d+$/.test((v || '').trim()) ? v!.trim() : null);
const keys = new Map<string, string>();
async function saved(type: 'movie' | 'tv', id: number) {
  const k = `${type}:${id}`;
  if (!keys.has(k)) keys.set(k, (await saveTitles([fromTmdb(type)(await tmdb<TmdbItem>(`/${type}/${id}`))]))[0].key);
  return keys.get(k)!;
}
async function movieKey(h: Hook) {
  const id = num(h.tmdb), imdb = imdbOf(h.imdb);
  if (id) return saved('movie', id).catch(() => null);
  return imdb ? resolve({ imdb }).catch(() => null) : null;
}
async function episodePlace(h: Hook) {
  const se = num(h.season), ep = num(h.episode);
  const byId = await tmdbEpisode({ tvdb: num(h.tvdb), imdb: imdbOf(h.imdb) }).catch(() => null);
  if (byId) return { key: await saved('tv', byId.show), se: byId.se, ep: byId.ep };
  if (!h.series || se == null || ep == null) return null;
  const year = num(h.year);
  const show = (await tmdb<{ results: TmdbItem[] }>(`/search/tv?query=${encodeURIComponent(h.series)}`).catch(() => null))?.results
    ?.sort((a, b) => Number(!!year && (b.first_air_date || '').startsWith(String(year))) - Number(!!year && (a.first_air_date || '').startsWith(String(year))))[0];
  if (!show) return null;
  const p = se > 0 ? await tmdbPlace(String(show.id), se, ep).catch(() => null) : null;
  return { key: await saved('tv', show.id), se: p?.se ?? se, ep: p?.ep ?? ep };
}

const placeOf = (h: Hook) => (h.type === 'Movie' ? movieKey(h).then((key) => (key ? { key, se: -1, ep: -1 } : null)) : h.type === 'Episode' ? episodePlace(h) : Promise.resolve(null));
const pctOf = (h: Hook) => { const pos = num(h.position), len = num(h.runtime); return pos != null && len ? Math.min(100, Math.round((pos / len) * 100)) : null; };
// Continue watching: 2 min to 90 % in (ticks: 10 000 a millisecond)
async function keepPlace(uid: string, h: Hook, place: { key: string; se: number; ep: number }, at: number) {
  const pct = pctOf(h);
  if ((num(h.position) ?? 0) >= 120000 * 10000 && pct != null && pct < 90) await saveResume(uid, 'jellyfin', { ...place, pct, at });
}

// what's playing: a start or progress event keeps it for 10 minutes (a start, without progress events, for its length)
async function playing(uid: string, h: Hook) {
  const place = await placeOf(h);
  if (!place) return { ok: false, error: 'not found' };
  const pos = num(h.position), len = num(h.runtime), at = Date.now();
  const pct = pctOf(h);
  await keepPlace(uid, h, place, at);
  const left = len && h.event === 'PlaybackStart' ? Math.max(0, len - (pos || 0)) / 10000 : 0;
  await setState(uid, 'jellyfin', 'now', { ...place, pct, at, until: at + Math.max(10 * 60000, left) } satisfies Now);
  return { ok: true, playing: true };
}
export async function jellyfinNow(uid: string) {
  const n = await getState<Now | null>(uid, 'jellyfin', 'now');
  return n && n.until > Date.now() ? n : null;
}

export async function jellyfinEvent(uid: string, h: Hook | null) {
  if (h && (h.event === 'PlaybackStart' || h.event === 'PlaybackProgress')) return playing(uid, h);
  if (h?.event === 'PlaybackStop') await setState(uid, 'jellyfin', 'now', null);
  const finished = !!h && (h.event === 'PlaybackStop' ? yes(h.done) : h.event === 'UserDataSaved' ? yes(h.played) : false);
  if (h?.event === 'PlaybackStop' && !finished) { const place = await placeOf(h); if (place) await keepPlace(uid, h, place, Date.now()); }
  if (!h || !finished) return { ok: true, recorded: 0 };
  const at = Date.now();
  let recorded = 0, name: string;
  if (h.type === 'Movie') {
    const key = await movieKey(h);
    if (!key) return { ok: false, error: 'movie not found' };
    recorded = await addPlay(uid, key, -1, -1, at, 'jellyfin');
    name = h.name || 'A movie';
  } else if (h.type === 'Episode') {
    const p = await episodePlace(h);
    if (!p) return { ok: false, error: 'episode not found' };
    const last = p.ep + Math.max(0, (num(h.episodeEnd) ?? 0) - (num(h.episode) ?? 0));
    for (let e = p.ep; e <= last; e++) recorded += await addPlay(uid, p.key, p.se, e, at, 'jellyfin');
    name = `${h.series || 'A show'} · ${h.name || `S${p.se} E${p.ep}`}`;
  } else return { ok: true, recorded: 0 };
  if (recorded) await setState(uid, 'jellyfin', 'last', { at, name });
  return { ok: true, recorded };
}
