// Reading uploaded exports: a zip's files (Letterboxd), CSV with quoted fields, and MyAnimeList's XML list, each turned into
// plain rows the importer resolves later. No dependencies: zip entries are stored or deflated, which node:zlib reads.
import zlib from 'node:zlib';
import type { SimklData } from './simkl';
import type { TraktData, TraktItem } from './trakt';

// what one unpacked file may grow to: far above any real export, low enough that a crafted archive can't fill the memory
const MAX_UNPACKED = 200 * 1024 * 1024;

// ---------- zip ----------
// a zip's files by name: the central directory at the end lists each entry, its size and where its data starts
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip file');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size);
    if (!name.endsWith('/')) out.set(name, method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: MAX_UNPACKED }) : method === 0 ? data : Buffer.alloc(0));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------- CSV ----------
// rows of a CSV as objects keyed by its header row (quoted fields may hold commas, quotes as "" and line breaks)
export function csv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
    } else field += c;
  }
  row.push(field); if (row.some((x) => x !== '')) rows.push(row);
  const [head = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ---------- Letterboxd ----------
// its export: diary.csv (each viewing, with Watched Date and Rewatch), watched.csv (every film marked watched, no dates),
// ratings.csv (0.5-5 stars) and watchlist.csv; columns are read by name, so a missing one only leaves that part out
export type LetterboxdFilm = { name: string; year: number | null; viewings: { date: string; rewatch: boolean }[]; watched: boolean;
  rating: number | null; ratedAt: string | null; want: string | null };
export function letterboxd(files: Map<string, Buffer>): LetterboxdFilm[] {
  const file = (name: string) => { for (const [k, v] of files) if (k.split('/').pop()?.toLowerCase() === name) return csv(v.toString('utf8')); return []; };
  const films = new Map<string, LetterboxdFilm>();
  const film = (r: Record<string, string>) => {
    const name = r.Name, year = Number(r.Year) || null, k = `${name}|${year ?? ''}`;
    if (!name) return null;
    return films.get(k) || films.set(k, { name, year, viewings: [], watched: false, rating: null, ratedAt: null, want: null }).get(k)!;
  };
  const day = (x: string | undefined) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  for (const r of file('diary.csv')) {
    const f = film(r), date = day(r['Watched Date']) || day(r.Date);
    if (f && date) f.viewings.push({ date, rewatch: /^yes$/i.test(r.Rewatch || '') });
  }
  for (const r of file('watched.csv')) { const f = film(r); if (f) f.watched = true; }
  for (const r of file('ratings.csv')) {
    const f = film(r), stars = Number(r.Rating);
    if (f && stars > 0) { f.rating = Math.min(10, Math.max(1, stars * 2)); f.ratedAt = day(r.Date); }
  }
  for (const r of file('watchlist.csv')) { const f = film(r); if (f) f.want = day(r.Date) || ''; }
  return [...films.values()];
}

// ---------- MyAnimeList ----------
// its XML list export (Profile › Export, a .xml.gz): one <anime> per entry with your status, episodes watched, score and dates
// kitsu: an entry from Kitsu's library (import/kitsu.ts), on its Kitsu id rather than MyAnimeList's
export type MalEntry = { mal: number; kitsu?: number; title: string; episodes: number; watched: number; score: number | null; status: string;
  started: string | null; finished: string | null };
// anilist: the file is an AniList list as MyAnimeList XML, so a wrong file says that
export function malXml(buf: Buffer, anilist = false): MalEntry[] {
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf, { maxOutputLength: MAX_UNPACKED }) : buf).toString('utf8');
  if (!/<myanimelist>/.test(text)) throw new Error(anilist ? "that isn't an AniList list as MyAnimeList XML: export it with an AniList exporter that writes MAL XML"
    : "not a MyAnimeList export (it's the .xml.gz from Profile › Export)");
  const tag = (block: string, name: string) => {
    const v = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`))?.[1]?.trim() ?? '';
    return v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
  };
  const date = (x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) && !x.startsWith('0000') ? x.replace(/-00/g, '-01') : null);
  return [...text.matchAll(/<anime>([\s\S]*?)<\/anime>/g)].map(([, b]) => ({
    mal: Number(tag(b, 'series_animedb_id')), title: tag(b, 'series_title'), episodes: Number(tag(b, 'series_episodes')) || 0,
    watched: Number(tag(b, 'my_watched_episodes')) || 0, score: Number(tag(b, 'my_score')) || null, status: tag(b, 'my_status'),
    started: date(tag(b, 'my_start_date')), finished: date(tag(b, 'my_finish_date')),
  })).filter((e) => e.mal);
}

// ---------- Trakt ----------
// its export (Settings › Data): a zip of JSON files; history comes in parts (watched-history-1.json, …), ratings per kind
export function traktExport(files: Map<string, Buffer>): TraktData {
  const json = (name: string): TraktItem[] => {
    for (const [k, v] of files) if (k.split('/').pop() === name) return JSON.parse(v.toString('utf8'));
    return [];
  };
  const parts = [...files.keys()].map((k) => k.split('/').pop()!).filter((n) => /^watched-history(-\d+)?\.json$/.test(n))
    .sort((a, b) => (Number(a.match(/\d+/)?.[0]) || 0) - (Number(b.match(/\d+/)?.[0]) || 0));
  const data = { history: parts.flatMap(json), ratings: ['movies', 'shows', 'seasons', 'episodes'].flatMap((k) => json(`ratings-${k}.json`)),
    watchlist: json('lists-watchlist.json').length ? json('lists-watchlist.json') : json('watchlist.json') };
  if (!data.history.length && !data.ratings.length && !data.watchlist.length) throw new Error('no Trakt history, ratings or watchlist in that file');
  return data;
}

// ---------- Simkl ----------
// its export (Simkl Pro: Apps › Export › Backup, ".zip archive with .json file"); the lists are found wherever the JSON keeps them
export function simklExport(buf: Buffer): SimklData {
  let text = buf.toString('utf8');
  if (buf.readUInt32LE(0) === 0x04034b50) {
    const json = [...unzip(buf)].find(([k]) => k.endsWith('.json'));
    if (!json) throw new Error('no .json file in that zip');
    text = json[1].toString('utf8');
  }
  const doc = JSON.parse(text);
  const find = (o: unknown, key: string, depth = 0): unknown[] => {
    if (!o || typeof o !== 'object' || depth > 3) return [];
    const v = (o as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v;
    for (const x of Object.values(o)) { const r = find(x, key, depth + 1); if (r.length) return r; }
    return [];
  };
  const data = { movies: find(doc, 'movies'), shows: find(doc, 'shows'), anime: find(doc, 'anime') } as SimklData;
  if (!data.movies.length && !data.shows.length && !data.anime.length) throw new Error("no movies, shows or anime in that file: it doesn't look like Simkl's .json backup");
  return data;
}
