// The calendar feed, an iCalendar subscription for Google, Apple or Outlook Calendar: the episodes the Airing calendar shows,
// and the release days of what's on Plan to watch and not out yet. Opened by the user's calendar key; made again after 30 min.
import { q } from './db';
import { details } from './details';
import { prefsOf } from './region';
import { tmdb } from './sources';
import { liveOf } from './store';
import { HOUR } from './util';

type Event = { uid: string; title: string; start: number; allDay: boolean; note?: string };
// a Plan to watch date for the Airing page
export type Planned = Event & { key: string; name: string; what: string; poster: string | null; movie: boolean };
type Dates = { results?: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };
const DAY = 24 * HOUR, EPISODE = HOUR / 2, AHEAD = 365 * DAY;
const made = new Map<string, { at: number; ics: string }>();
const movieDates = new Map<string, { at: number; dates: Dates | null }>();
const plans = new Map<string, { at: number; list: Promise<Planned[]> }>();

const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const utc = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (t: number) => new Date(t).toLocaleDateString('sv-SE').replace(/-/g, '');
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let n = 75;
    while (Buffer.byteLength(rest.slice(0, n)) > 75) n--;
    out.push(rest.slice(0, n)); rest = ` ${rest.slice(n)}`;
  }
  return [...out, rest].join('\r\n');
}
const epLabel = (season: number | null, ep: number) => (season != null && season >= 0 ? `S${season} E${ep}` : `E${ep}`);

async function datesOf(id: string) {
  const c = movieDates.get(id);
  if (c && Date.now() - c.at < 12 * HOUR) return c.dates;
  const dates = await tmdb<Dates>(`/movie/${id}/release_dates`).catch(() => null);
  movieDates.set(id, { at: Date.now(), dates });
  return dates;
}

async function airing(uid: string): Promise<Event[]> {
  const now = Date.now();
  return ((await liveOf(uid)).schedule || []).filter((e) => e.at >= now - DAY).map((e) => ({
    uid: `${e.key}:${e.season ?? 0}:${e.ep}`, title: `${e.title} · ${epLabel(e.season, e.ep)}`, start: e.at, allDay: e.dayOnly }));
}

// cached 30 min
export function plannedOf(uid: string) {
  const c = plans.get(uid);
  if (c && Date.now() - c.at < HOUR / 2) return c.list;
  const list = planned(uid);
  plans.set(uid, { at: Date.now(), list });
  list.catch(() => plans.delete(uid));
  return list;
}

async function planned(uid: string): Promise<Planned[]> {
  const now = Date.now(), region = (await prefsOf(uid)).country || 'US', out: Planned[] = [];
  const keys = (await q.all<{ key: string }>('select key from watchlist where user_id = ? order by added_at desc limit 80', uid)).map((r) => r.key);
  const soon = (t: number) => Number.isFinite(t) && t > now - DAY && t < now + AHEAD;
  for (const key of keys) {
    const d = await details(key).catch(() => null);
    if (!d) continue;
    const movie = /^tmdb:movie:(\d+)$/.exec(key);
    const add = (id: string, what: string, start: number) => out.push({ uid: id, title: `${d.title} · ${what}`, start, allDay: true, key, name: d.title, what, poster: d.poster || null, movie: !!movie });
    if (movie) {
      const all = (await datesOf(movie[1]))?.results || [], here = all.find((g) => g.iso_3166_1 === region)?.release_dates || [];
      const first = (types: number[]) => Math.min(...here.filter((x) => types.includes(x.type)).map((x) => Date.parse(x.release_date)));
      for (const [kind, types] of [['In cinemas', [2, 3]], ['On digital', [4]], ['On disc', [5]]] as const) {
        const at = first([...types]);
        if (soon(at)) add(`${key}:${kind}`, kind.toLowerCase(), at);
      }
      const released = d.released ? Date.parse(d.released) : NaN;
      if (!here.length && soon(released)) add(`${key}:out`, 'out', released);
      continue;
    }
    const premiere = d.released ? Date.parse(d.released) : NaN;
    if (soon(premiere)) { add(`${key}:premiere`, 'premiere', premiere); continue; }
    const next = d.next?.date ? Date.parse(d.next.date) : NaN;
    if (soon(next) && d.next?.ep != null)
      add(`${key}:${d.next.season ?? 0}:${d.next.ep}`, d.next.ep === 1 && d.next.season ? `season ${d.next.season} premiere` : epLabel(d.next.season ?? null, d.next.ep), next);
  }
  return out;
}

export async function calendarOf(uid: string) {
  const c = made.get(uid);
  if (c && Date.now() - c.at < HOUR / 2) return c.ics;
  const seen = new Set<string>(), events = [...await airing(uid), ...await plannedOf(uid)].filter((e) => !seen.has(e.uid) && seen.add(e.uid));
  const stamp = utc(Date.now());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Listick//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Listick',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const e of events.sort((a, b) => a.start - b.start)) {
    lines.push('BEGIN:VEVENT', `UID:${esc(e.uid)}@listick`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(e.title)}`, 'TRANSP:TRANSPARENT',
      ...(e.allDay ? [`DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(e.start + DAY)}`] : [`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.start + EPISODE)}`]),
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const ics = `${lines.map(fold).join('\r\n')}\r\n`;
  made.set(uid, { at: Date.now(), ics });
  return ics;
}
