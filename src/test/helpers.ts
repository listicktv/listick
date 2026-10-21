// Test helpers: a freshly migrated database, outside calls answered from fixtures, and requests sent straight to the API handler.
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '@/db';
import { auth } from '@/lib/auth';
import { handle } from '@/server/api';
import { q } from '@/server/db';
import { saveTitles } from '@/server/titles';
import { setProfile } from '@/server/store';
import type { Title } from '@/server/types';

export const ORIGIN = 'http://localhost:3000';

export async function resetDb() {
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(db, { migrationsFolder: 'drizzle' });
}

// outside APIs: a URL containing a fixture's key gets its JSON, anything else a 404; every call is recorded. Resend always
// answers, and each email sent is kept in mails
export const calls: string[] = [];
export const mails: { to: string; subject: string; text: string }[] = [];
export const bodies: { url: string; body: Record<string, string> }[] = [];   // form posts (OAuth token exchanges)
export function fixtures(map: Record<string, unknown>) {
  calls.length = 0; mails.length = 0; bodies.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url === 'https://api.resend.com/emails') { mails.push(JSON.parse(String(init?.body))); return Response.json({ id: 'test' }); }
    if (init?.body instanceof URLSearchParams) bodies.push({ url, body: Object.fromEntries(init.body) });
    const hit = Object.keys(map).find((k) => url.includes(k));
    return hit ? Response.json(map[hit]) : new Response('not found', { status: 404 });
  }) as typeof fetch;
}

export async function addUser(username: string, password = 'password-123') {
  const r = await auth.api.signUpEmail({ body: { email: `${username}@example.com`, password, name: username, username, displayUsername: username } });
  await setProfile(r.user.id, { tracking_since: Date.now() });
  await q.run('update "user" set email_verified = true where id = ?', r.user.id);   // a ready account: no confirmation step
  return r.user.id;
}

export const title = (key: string, t: Partial<Title> = {}): Title => ({
  key, type: key.startsWith('tmdb:movie:') ? 'movie' : key.startsWith('tmdb:tv:') ? 'tv' : 'anime', title: key, label: null, year: 2020,
  poster: null, backdrop: null, rating: 7, rating_src: 'tmdb', overview: null, url: null, fetched_at: Date.now(), anime: 0, episodes: null,
  genres: null, ...t,
});
export const addTitles = (...ts: Title[]) => saveTitles(ts);

// a request to /api/*; returns the status, the JSON body, any cookies set and where a redirect points
export async function api(path: string, { method = 'GET', body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await handle(new Request(`${ORIGIN}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await r.text();
  let json: any = null;   // eslint-disable-line @typescript-eslint/no-explicit-any -- each test reads the fields it checks
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, json, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), location: r.headers.get('location') };
}

// signed in as username: its cookie and CSRF token, and a helper for writes from the page's origin
export async function signIn(username: string, password = 'password-123', ip = '198.51.100.1') {
  const r = await api('/api/login', { method: 'POST', body: { name: username, password }, headers: { origin: ORIGIN, 'x-forwarded-for': ip } });
  if (r.status !== 200) throw new Error(`sign-in failed: ${r.status} ${JSON.stringify(r.json)}`);
  const { cookie } = r, csrf: string = r.json.csrf;
  return {
    get: (path: string) => api(path, { headers: { cookie } }),
    post: (path: string, body: unknown = {}) => api(path, { method: 'POST', body, headers: { cookie, origin: ORIGIN, 'x-listick-token': csrf } }),
    cookie, csrf,
  };
}
