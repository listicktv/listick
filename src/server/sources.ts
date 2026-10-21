// Outside sources: every call out goes through fetchCounted (counted per day and service), and the TMDB, Kitsu and MAL clients.
import { q } from './db';
import { env, netErr } from './util';

// ---------- API calls out, per service and day (the OMDb daily limit reads them) ----------
// Every outside call goes through fetchCounted; a 429 counts as throttled. Counts collect in memory and flushCalls adds them to
// api_calls (per day, role and service): the worker every 30 s, the web app after each request, since a serverless host can
// freeze the process between requests and run many copies at once.
const API_HOSTS: Record<string, string> = { 'api.themoviedb.org': 'tmdb', 'www.omdbapi.com': 'omdb', 'api.myanimelist.net': 'mal', 'myanimelist.net': 'mal',
  'kitsu.io': 'kitsu', 'kitsu.app': 'kitsu' };
export const OMDB_DAILY = 1000;   // the free key's limit
export const localDay = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD in TZ
const role = () => env('LISTICK_ROLE') || 'web';   // which process counted: web or worker
const unsaved = new Map<string, { calls: number; throttled: number }>();   // `<day>|<service>` -> not yet in api_calls
const count = (svc: string, field: 'calls' | 'throttled') => {
  const k = `${localDay()}|${svc}`, c = unsaved.get(k) || { calls: 0, throttled: 0 };
  c[field]++; unsaved.set(k, c);
};
export async function flushCalls() {
  const rows = [...unsaved];
  unsaved.clear();
  for (const [k, c] of rows) {
    const [day, svc] = k.split('|');
    await q.run(`insert into api_calls (day, role, service, calls, throttled) values (?, ?, ?, ?, ?) on conflict (day, role, service)
      do update set calls = api_calls.calls + excluded.calls, throttled = api_calls.throttled + excluded.throttled`, day, role(), svc, c.calls, c.throttled);
  }
}
// who is asking, on every call out (Wikidata's policy wants a name and a way to reach us; the others are told the same)
export const USER_AGENT = () => `Listick/1.0 (+${env('APP_ORIGIN').split(',')[0].trim() || 'https://github.com/listicktv/listick'}${env('LISTICK_CONTACT') ? `; ${env('LISTICK_CONTACT')}` : ''})`;
export async function fetchCounted(input: string | URL | Request, init?: RequestInit) {
  let svc: string | null = null;
  try { svc = API_HOSTS[new URL(typeof input === 'string' || input instanceof URL ? input : input.url).host] || null; } catch { /* not a URL we count */ }
  if (svc) count(svc, 'calls');
  const headers = new Headers(init?.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT());
  const r = await fetch(input, { ...init, headers });
  if (svc && r.status === 429) count(svc, 'throttled');
  return r;
}

// ---------- sources ----------
export async function fetchJSON<T>(url: string, { timeout = 10000, ...init }: RequestInit & { timeout?: number } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  const r = await fetchCounted(url, { ...init, headers, signal: AbortSignal.timeout(timeout) })
    .catch((e) => { throw new Error(`${new URL(url).host}: ${netErr(e)}`); });
  if (!r.ok) throw new Error(`${url.split('?')[0]} -> ${r.status}`);
  return r.json() as Promise<T>;
}
export const getJSON = <T>(url: string, headers: Record<string, string> = {}, timeout = 10000) => fetchJSON<T>(url, { headers, timeout });
export const TMDB_IMG = 'https://image.tmdb.org/t/p/';
export const tmdb = <T>(path: string) => getJSON<T>(`https://api.themoviedb.org/3${path}`, { Authorization: `Bearer ${env('TMDB_ACCESS_TOKEN')}` });
export const kitsu = <T>(path: string) => getJSON<T>(`https://kitsu.io/api/edge${path.replace(/\[/g, '%5B').replace(/\]/g, '%5D')}`, { accept: 'application/vnd.api+json' });

// MyAnimeList's official API (MAL_CLIENT_ID): with it the anime rows follow MAL's ranking (Kitsu's user base is small, so its
// own drifts); without it, Kitsu's.
export const mal = <T>(path: string) => getJSON<T>(`https://api.myanimelist.net/v2${path}`, { 'X-MAL-CLIENT-ID': env('MAL_CLIENT_ID') });
