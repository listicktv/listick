// The home page's data (/api/summary) and the card lists made from it: History, Continue watching, Up next, Plan to watch.
// Only the fields the page reads are typed here.
import { ago, epLabel } from './format';
import { oneCardPerTitle } from '@/lib/cards';

export type TitleType = 'movie' | 'tv' | 'anime';
// a title as a poster card shows it; watchlist / watched / mine are where you are with it
export type Tile = { key: string; type: TitleType; title: string; poster: string | null; year?: number | null; label?: string | null;
  note?: string | null; what?: string | null; date?: string | null; why?: string | null; tag?: string | null; dismiss?: boolean;
  watchlist?: boolean; watched?: number | boolean | null; mine?: number | null; progress?: number | null; lastAt?: number | null; next?: string | null };
// kind: a row of its own (In theaters, Coming soon…) says which page it's on
export type Row = { id: string; kind?: TitleType; title: string; items: Tile[]; total?: number };
// kind: also 'anime-movie', the Anime page's films
export type Shelf = { id: string; kind: TitleType | 'anime-movie'; rows: Row[] };
// kinds: what it has titles of (a page offers only the services with its kind)
export type Service = { id: string; name: string; logo: string; kinds?: (TitleType | 'anime-movie')[] };
type StEp = { title: string; season: number | null; ep: number | null; at: number; dayOnly?: boolean; poster?: string | null; watched?: boolean };
type StCard = StEp & { id: string; type: string; poster: string | null; url: string };
type StContinue = StCard & { pct: number; resume?: boolean; video?: string | null; airedAt?: number; ids?: string[];
  place?: { key: string; type: TitleType; se: number; ep: number; title: string; poster: string | null; backdrop: string | null } | null };
type UpNext = { key: string; type: TitleType; title: string; poster: string | null; backdrop: string | null; se: number; ep: number; at: number; airedAt: number | null };
export type AirEp = { key: string; title: string; poster: string | null; season: number | null; ep: number; at: number; dayOnly: boolean; watched: boolean; anime: boolean };
type Play = { key: string; type: TitleType; title: string; poster: string | null; backdrop: string | null; at: number; season: number; episode: number; mine?: number | null; source: string };
type Planned = { key: string; type: TitleType; title: string; poster: string | null; backdrop: string | null; addedAt: number; label?: string | null; year?: number | null; anime?: boolean };
export type Summary = {
  stremio?: { continue?: StContinue[]; history?: StCard[] } | null;
  watching?: { source: string; key: string; se: number; ep: number; pct: number | null; at: number; title: string; type: TitleType; poster: string | null; backdrop: string | null }[];
  upNext?: UpNext[]; schedule?: AirEp[];
  media?: { recent?: Play[]; watchlist?: Planned[]; rows?: Row[]; group?: Shelf | null; service?: Shelf | null; services?: Service[] } | null;
  forYou?: { suggested?: Tile[]; coming?: Tile[] } | null;
};

export type Ref = { key: string } | { imdb: string };
// a wide card (History, Continue watching, Up next, Plan to watch)
export type Wide = { app: string; ref: Ref | null; ids?: string[]; title: string; poster: string | null; wide: string | null; url?: string; at: number;
  sub: string; pct?: number; airedAt?: number; isNew?: boolean; watching?: boolean; resume?: boolean;
  cw?: { id: string; video?: string | null; at: number; key?: string; se?: number; ep?: number; movie: boolean } | null;
  play?: { key: string; season: number; episode: number; mine?: number | null } };

export const APP_NAME: Record<string, string> = { listick: 'Listick', stremio: 'Stremio', jellyfin: 'Jellyfin', anilist: 'AniList', tmdb: 'TMDB', kitsu: 'Kitsu', manual: 'Marked by you', imported: 'Past history' };
export const TYPE_NAME: Record<TitleType, string> = { movie: 'Movie', tv: 'TV', anime: 'Anime' };

const imdbRef = (id: string | undefined) => (/^tt\d+$/.test(id || '') ? { imdb: id! } : null);
// Stremio's image server: a 480×270 background per IMDb title (~30 KB)
const stremioWide = (id: string | undefined) => (/^tt\d+$/.test(id || '') ? `https://images.metahub.space/background/small/${id}/img` : null);

// one list, newest first: what you stopped partway in Stremio (Continue watching), and the next aired episode of each show and
// anime you played lately (Up next, from the History: upnext.ts)
// watching now: what a player says is playing (Jellyfin), or a Stremio item played in the last 20 minutes
const NOW = 20 * 60000;
export function continueItems(S: Summary) {
  const out: Wide[] = [];
  for (const w of (S.watching || []).filter((x) => x.source !== 'stremio')) out.push({ app: w.source, ref: { key: w.key }, ids: [w.key], title: w.title, poster: w.poster, wide: w.backdrop, at: w.at, pct: w.pct ?? undefined,
    watching: true, sub: `${w.se < 0 ? 'Movie' : w.type === 'anime' ? `E${w.ep}` : `S${w.se} E${w.ep}`}${w.pct != null ? ` · ${w.pct} %` : ''}` });
  for (const u of S.upNext || []) out.push({ app: 'listick', ref: { key: u.key }, ids: [u.key], title: u.title, poster: u.poster, wide: u.backdrop, at: u.at,
    airedAt: u.airedAt ?? undefined, sub: `${u.type === 'anime' ? `E${u.ep}` : `S${u.se} E${u.ep}`} · next up` });
  // a placed episode uses its TMDB/Kitsu title, artwork and numbering (the same as the History row)
  for (const c of (S.stremio?.continue || []).filter((x) => x.resume)) {
    const p = c.place, ep = p ? (p.type === 'anime' ? `E${p.ep}` : `S${p.se} E${p.ep}`) : c.type === 'movie' ? 'Movie' : epLabel(c);
    out.push({ app: 'stremio', ref: p ? { key: p.key } : imdbRef(c.id), ids: c.ids, title: p?.title || c.title, poster: p?.poster || c.poster,
      wide: p?.backdrop || stremioWide(c.id), url: c.url, at: c.at, pct: c.pct, airedAt: c.airedAt, resume: !!c.resume, sub: `${ep} · ${c.resume ? `${c.pct} %` : 'next up'}`,
      cw: c.resume && (p || c.type === 'movie') ? { id: c.id, video: c.video, at: c.at, key: p?.key, se: p?.se, ep: p?.ep, movie: c.type === 'movie' } : null,
      watching: !!c.resume && Date.now() - c.at < NOW });
  }
  // NEW: the episode you're up to came out in the last 4 days
  out.sort((a, b) => Number(!!b.watching) - Number(!!a.watching));
  return oneCardPerTitle(out).slice(0, 15).map((w) => ({ ...w, isNew: !w.watching && !!w.airedAt && Date.now() - w.airedAt < 4 * 86400000 }));
}
// History: from our own database (every play, last 30 days, one card per title); the live sources only if the media
// service is unreachable. Imported past data (Trakt, MDBList) was watched in Stremio, so it shows Stremio's logo; new plays
// carry their real source
const SOURCE_APP: Record<string, string> = { stremio: 'stremio', anilist: 'anilist', jellyfin: 'jellyfin', manual: 'manual', trakt: 'stremio', mdblist: 'stremio' };
export function historyItems(S: Summary) {
  if (S.media?.recent) return oneCardPerTitle(S.media.recent.map((h) => ({ app: SOURCE_APP[h.source] || 'imported', ref: { key: h.key }, title: h.title,
    poster: h.poster, wide: h.backdrop, at: h.at, play: { key: h.key, season: h.season, episode: h.episode, mine: h.mine },
    sub: `${h.type === 'movie' ? 'Movie' : h.season >= 0 ? (h.type === 'anime' ? `E${h.episode}` : `S${h.season} E${h.episode}`) : ''} · ${ago(h.at)} ago` })));
  const out: Wide[] = [];
  for (const h of S.stremio?.history || []) out.push({ app: 'stremio', ref: imdbRef(h.id), title: h.title, poster: h.poster, wide: stremioWide(h.id), url: h.url, at: h.at,
    sub: `${h.type === 'movie' ? 'Movie' : epLabel(h)} · ${ago(h.at)} ago` });
  return oneCardPerTitle(out.filter((x) => x.at)).slice(0, 15);
}
// Plan to watch: Listick's watchlist (movies, TV and anime), newest first
export function planItems(S: Summary) {
  const out: Wide[] = [];
  for (const w of S.media?.watchlist || []) out.push({ app: w.type === 'anime' ? 'kitsu' : 'tmdb', ref: { key: w.key }, title: w.title, poster: w.poster, wide: w.backdrop,
    at: w.addedAt, sub: [TYPE_NAME[w.type], w.label, w.year].filter(Boolean).join(' · ') });
  return out.sort((a, b) => b.at - a.at);
}

export function comingTag(date: string | null | undefined) {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`), days = Math.round((d.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: '2-digit' } : {}) });
}

// when you last changed a title here: a refresh that was asked for before that (or before its save finished) carries the old
// state and must not flip the card back
const changedAt = new Map<string, number>();
let fetchedAt = 0;   // when the data shown was asked for
export const touchKey = (key: string) => { changedAt.set(key, Date.now()); };
export const setFetchedAt = (t: number) => { fetchedAt = t; };
export const staleFor = (key: string) => (changedAt.get(key) || 0) > fetchedAt;
// a change saved on one poster reaches every card of that title (the same title can sit in several rows)
export type TilePatch = Partial<Pick<Tile, 'watchlist' | 'watched' | 'mine' | 'progress' | 'lastAt' | 'next'>>;
export const cards = new EventTarget();
export const syncCards = (key: string, patch: TilePatch) => cards.dispatchEvent(new CustomEvent('sync', { detail: { key, patch } }));
