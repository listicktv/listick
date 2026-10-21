// The page's /api and the public API /api/v1/* (opened by an app's key). Sign-in is Better Auth's; writes
// also need the page's origin and a header token derived from the session.
import crypto from 'node:crypto';
import { auth } from '@/lib/auth';
import { q, tx } from './db';
import { mailOn, ORIGINS, LINK_ORIGIN } from './mail';
import { exportOf } from './account';
import { calendarOf } from './calendar';
import { alert } from './alert';
import { letterboxd, malXml, simklExport, traktExport, unzip } from './import/files';
import { kitsuLibrary } from './import/kitsu';
import { countries, isCountry, options, prefsOf, regionOf, setPrefs } from './region';
import { MEDIA, builtinOf, copyList, createList, deleteList, follow, isBuiltin, listOf, listsOf, membership, pickSearch, preview, refreshList, rowLists, setItem, updateList, type Filters, type Media } from './lists';
import { statsOf, type Period } from './stats';
import { importsOf, queueImport } from './import/run';
import { stremioMeta, stremioSearch } from './addon';
import { playCount } from './cards';
import { FOR_YOU, catalogList, catalogSources } from './catalogs';
import { details, season } from './details';
import { canonKey, resolve } from './mapping';
import { hero, landingPosters, pageData, rowAll, search, shelves } from './page';
import { insertPlay, mark, rate, retime } from './plays';
import { makeUser, noUsers, placeholderEmail } from './owner';
import { allUsers, getState, getUser, ownerId, setProfile, setState } from './store';
import { KEY, getTitle } from './titles';
import { forgetLive } from './tracking';
import { appName, env, HOUR, msg, safe } from './util';
import type { TitleType, User } from './types';

type Body = Record<string, unknown>;
type Gate = { user: User; error?: undefined } | { error: Response; user?: undefined };

const sha = (x: string) => crypto.createHash('sha256').update(x).digest('hex');
const csrfOf = (token: string) => sha(`csrf:${token}`);

// a GET's JSON carries a tag of its content: the page's 15-second refresh asks "changed since?" and gets 304 (no body) while
// it hasn't. Kept private to the browser, revalidated every time (compression is the server's)
function json(req: Request, code: number, obj: unknown, extra: Record<string, string> = {}) {
  const body = JSON.stringify(obj);
  const head = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  if (req.method === 'GET' && code === 200 && body.length >= 1024) {
    const tag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
    head.set('cache-control', 'private, no-cache'); head.set('etag', tag);
    if (req.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers: head });
  }
  return new Response(body, { status: code, headers: head });
}
// a reply that also carries Better Auth's cookies (signed in, signed out)
const withCookies = (res: Response, from: Response | null | undefined) => { for (const c of from?.headers.getSetCookie?.() || []) res.headers.append('set-cookie', c); return res; };
const body = async (req: Request): Promise<Body> => { try { return await req.json(); } catch { return {}; } };

// ---------- who is asking ----------
async function sessionOf(req: Request) {
  const s = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  if (!s) return null;
  const u = await getUser(s.user.id);
  return u ? { token: s.session.token, user: u } : null;
}
// sign-in attempts per address: 10 in 10 minutes, counted in the database so every instance of the web app sees them all
const ATTEMPTS_MS = 600000;
// the client's address: the X-Forwarded-For entry the outermost of LISTICK_TRUSTED_PROXIES reverse proxies added (default 1),
// counted from the right, since a client can put any entries of its own in front of the ones the proxies add
const PROXIES = Math.max(1, Math.floor(Number(env('LISTICK_TRUSTED_PROXIES'))) || 1);
const clientIp = (req: Request) => {
  const hops = (req.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim()).filter(Boolean);
  return hops[Math.max(0, hops.length - PROXIES)] || 'local';
};
async function tooMany(req: Request) {
  const ip = clientIp(req), now = Date.now();
  await q.run('delete from sign_in_attempts where at < ?', now - ATTEMPTS_MS);
  await q.run('insert into sign_in_attempts (ip, at) values (?, ?)', ip, now);
  return (await q.one<{ n: number }>('select count(*) n from sign_in_attempts where ip = ? and at >= ?', ip, now - ATTEMPTS_MS))!.n > 10;
}
const sameOrigin = (req: Request) => !ORIGINS.length || ORIGINS.includes(req.headers.get('origin') || '');
// a read: the signed-in user, else a 401 reply
async function reader(req: Request): Promise<Gate> {
  const s = await sessionOf(req);
  return s ? { user: s.user } : { error: json(req, 401, { error: 'sign in' }) };
}
// a write: POST, the page's origin, the session and its header token
async function guard(req: Request): Promise<Gate> {
  if (req.method !== 'POST') return { error: json(req, 405, { error: 'method' }) };
  if (!sameOrigin(req)) return { error: json(req, 403, { error: 'origin' }) };
  const s = await sessionOf(req);
  if (!s) return { error: json(req, 401, { error: 'sign in' }) };
  if (req.headers.get('x-listick-token') !== csrfOf(s.token)) return { error: json(req, 403, { error: 'session' }) };
  return { user: s.user };
}
const pubUser = (u: User) => ({ id: u.id, name: u.name, firstName: u.first_name || null, admin: !!u.admin });
const passOk = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 200;
const nameOk = (n: unknown): n is string => typeof n === 'string' && /^[\p{L}\p{N}_.-]{2,30}$/u.test(n);
const firstOk = (f: unknown): f is string => typeof f === 'string' && f.trim().length >= 1 && f.trim().length <= 40;
const emailOk = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
// a user by sign-in name or email
const findLogin = async (x: unknown) => (typeof x === 'string' && x.trim()
  ? (await q.one<{ id: string }>(`select id from "user" where lower(username) = lower(?) or lower(email) = lower(?)`, x.trim(), x.trim()))?.id ?? null : null);
const emailOf = async (id: string | null | false | undefined) => (id ? (await q.one<{ email: string }>('select email from "user" where id = ?', id))?.email : undefined);
// a user's password, checked the way Better Auth checks it at sign-in
async function checkPass(uid: string, password: unknown) {
  if (typeof password !== 'string') return false;
  const ctx = await auth.$context, acc = (await ctx.internalAdapter.findAccounts(uid)).find((a) => a.providerId === 'credential');
  return !!acc?.password && ctx.password.verify({ hash: acc.password, password });
}
// where an emailed confirmation link (a changed email) lands, signed in, and with ?error= a used or expired one
const VERIFIED = '/?verified=1';
// signs in by username or email: Better Auth's reply (its cookies) and the session token, or null
async function signIn(login: unknown, password: unknown) {
  const name = String(login || '').trim(), id = await findLogin(name);
  const email = await emailOf(id);
  if (!email || typeof password !== 'string') return null;
  const r = await auth.api.signInEmail({ body: { email, password, callbackURL: VERIFIED }, asResponse: true }).catch(() => null);
  if (!r?.ok) return null;
  const j: { token: string; user: { id: string } } = await r.clone().json();
  return { res: r, token: j.token, uid: j.user.id };
}
// a source changed (another Stremio account): what was seen of the old one is forgotten, so the new one starts
// from a fresh baseline instead of reading as a burst of plays
const forgetSource = (uid: string, sources: string[]) => q.run('delete from sync_state where user_id = ? and source = any(?)', uid, sources);
// the apps a user can make an API key for (one key each) and the scopes of the public API (docs/api.md) each key opens: lists
// (your lists and their titles), stremio (Stremio-shaped metas and search), calendar (the feed). A new app is one line here
const APPS = [{ id: 'catalogs', name: 'Stremio Catalogs', scopes: ['lists', 'stremio'] }, { id: 'calendar', name: 'Calendar feed', scopes: ['calendar'] }];
// a key's user and app, if the key is real
const keyOf = (token: string) => (/^[\w-]{10,128}$/.test(token) ? q.one<{ id: string; app: string }>('select user_id id, addon app from api_keys where token = ?', token) : null);
const mayUse = (app: string, scope: string) => !!APPS.find((a) => a.id === app)?.scopes.includes(scope);
async function account(uid: string) {
  const u = (await getUser(uid))!;
  const keys = Object.fromEntries((await q.all<{ addon: string; token: string }>('select addon, token from api_keys where user_id = ?', uid)).map((r) => [r.addon, r.token]));
  return { ...pubUser(u), email: u.email || null, mail: mailOn(), stremio: u.stremio_key ? (u.stremio_user || 'connected') : null,
    apiKeys: APPS.map(({ id, name }) => ({ id, name, key: keys[id] || null })) };
}
// Stremio's own sign-in (the request its apps send, stremio-core's AuthRequest::Login): only the session key it returns is kept
async function stremioLogin(email: string, password: string) {
  const r = await fetch('https://api.strem.io/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'Login', email, password, facebook: false }), signal: AbortSignal.timeout(10000) });
  const d: { result?: { authKey?: string }; error?: { message?: string } } = await r.json().catch(() => ({}));
  if (!d.result?.authKey) throw new Error(d.error?.message || `Stremio answered ${r.status}`);
  return d.result.authKey;
}
// captcha (Cloudflare Turnstile): on once its keys are set; a token is good once, for 5 minutes
const captchaOn = () => !!env('TURNSTILE_SITE_KEY') && !!env('TURNSTILE_SECRET');
async function captchaOk(req: Request, token: unknown) {
  if (!captchaOn()) return true;
  if (typeof token !== 'string' || !token) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ secret: env('TURNSTILE_SECRET'), response: token, remoteip: clientIp(req) }) }).catch(() => null);
  return !!(await r?.json().catch(() => null))?.success;
}
const INVITE_MS = 7 * 24 * HOUR;
type Invite = { token: string; created_by: string | null; created_at: number; expires: number; used_by: string | null; used_at: number | null };
const liveInvite = async (t: unknown) => (typeof t === 'string' && t ? q.one<Invite>('select * from invites where token = ? and used_at is null and expires > ?', sha(t), Date.now()) : null);
// a time in ms that isn't in the future (an hour of clock drift allowed)
const past = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0 && t < Date.now() + 3600000;
// a play whose date isn't known goes on the release day; without one (TMDB has none for some old titles) on its year's middle,
// else now; null only for a title not out yet (a later release, or still planned, filmed or rumoured)
const NOT_OUT = ['Rumored', 'Planned', 'In Production', 'Post Production', 'upcoming', 'unreleased', 'tba'];
async function unknownDay(key: string) {
  const d = await details(key).catch(() => null), year = (await getTitle(key))?.year ?? d?.year ?? null;
  if (d?.released) { const at = new Date(`${d.released}T19:00:00Z`).getTime(); return past(at) ? at : null; }
  if (d?.status && NOT_OUT.includes(d.status)) return null;
  if (year && year < new Date().getUTCFullYear()) return Date.UTC(year, 6, 1, 19);
  return year && year > new Date().getUTCFullYear() ? null : Date.now();
}

// ---------- the title, search and marking routes (the page's /api/*) ----------
async function internal(req: Request, url: URL, method: string, uid: string) {
  const p = url.pathname;
  const ra = method === 'GET' && p.match(/^\/row\/([\w-]+)$/);
  if (ra) { const out = await rowAll(ra[1], uid); return out ? json(req, 200, out) : json(req, 404, { error: 'no such row' }); }
  const hk = method === 'GET' && p.match(/^\/hero\/(movie|tv|anime)$/);
  if (hk) return json(req, 200, await hero(hk[1] as TitleType, uid));
  if (method === 'GET' && p === '/shelf') {
    const s = url.searchParams;
    return json(req, 200, await shelves(uid, { group: s.get('group'), gkind: s.get('kind'), svc: s.get('svc'), skind: s.get('kind') }));
  }
  if (method === 'GET') {
    const sm = p.match(/^\/title\/([^/]+)\/season\/(\d+)$/);
    if (sm) {
      const key = decodeURIComponent(sm[1]);
      if (!KEY.test(key) || key.startsWith('tmdb:movie:')) return json(req, 400, { error: 'bad key' });
      return json(req, 200, { episodes: await season(key, Number(sm[2]), uid) });
    }
    const m = p.match(/^\/title\/([^/]+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (!KEY.test(key)) return json(req, 400, { error: 'bad key' });
      // a Kitsu entry Fribb maps opens as its TMDB show (the card works on the key it gets back)
      return json(req, 200, await details(await canonKey(key), uid));
    }
    if (p === '/resolve') {
      const imdb = url.searchParams.get('imdb');
      if (!imdb || !/^tt\d+$/.test(imdb)) return json(req, 400, { error: 'imdb=tt…' });
      return json(req, 200, { key: await resolve({ imdb }) });
    }
    if (p === '/search') {
      const text = (url.searchParams.get('q') || '').trim();
      if (text.length < 2 || text.length > 100) return json(req, 400, { error: 'q: 2-100 characters' });
      return json(req, 200, { results: await search(text, uid) });
    }
  }
  const wm = p.match(/^\/(mark|rate|retime)\/([^/]+)$/);
  if (wm && method === 'POST') {
    const key = decodeURIComponent(wm[2]);
    if (!KEY.test(key)) return json(req, 400, { error: 'bad key' });
    const b = await body(req);
    if (wm[1] === 'retime') {
      if (!Number.isInteger(b.season) || !Number.isInteger(b.episode) || !past(b.from) || !past(b.at)) return json(req, 400, { error: 'season, episode, from, at (ms, not in the future)' });
      return json(req, 200, { changed: await retime(uid, key, b.season as number, b.episode as number, b.from, Math.round(b.at)) });
    }
    if (wm[1] === 'rate') {
      // 1-10 in 0.1 steps (Trakt's imports are whole numbers)
      const r = b.rating == null ? null : Math.round(Number(b.rating) * 10) / 10;
      if (r != null && !(Number.isFinite(r) && r >= 1 && r <= 10)) return json(req, 400, { error: 'rating 1-10 (0.1 steps) or null' });
      const se = b.season ?? -1, ep = b.episode ?? -1;
      if (!Number.isInteger(se) || !Number.isInteger(ep) || ((ep as number) >= 0 && (se as number) < 0)) return json(req, 400, { error: 'season, episode: integers (-1 for none)' });
      const changed = await rate(uid, key, r, se as number, ep as number);
      // rating a movie you have no play of means you saw it: one play with the date unknown (approx 1, kept on its release
      // date like the imports'), never "now"; its date can be set later
      if (r != null && se === -1 && key.startsWith('tmdb:movie:') && !await playCount(uid, key)) {
        const at = await unknownDay(key);
        if (at) await insertPlay(uid, key, -1, -1, at, 1, 'manual');
      }
      return json(req, 200, { changed });
    }
    const eps = Array.isArray(b.episodes) ? (b.episodes.filter(Number.isInteger) as number[]).slice(0, 500) : [-1];
    if (!Number.isInteger(b.season ?? -1) || !eps.length) return json(req, 400, { error: 'season, episodes' });
    if (!await getTitle(key)) await details(key).catch(() => null);
    // at 'unknown': watched, date not known (a poster's Watched; the title card sets the date): one play on the release day
    // (unknownDay), approx 1, like the imports' and a first rating's
    let approx = b.unknown === true ? 1 : 0;   // unknown: a given time (an episode's air day) that only stands in for the date
    let at = b.at;
    if (at === 'unknown') {
      at = await unknownDay(key); approx = 1;
      if (at == null) return json(req, 400, { error: "it isn't out yet" });
    }
    if (at != null && !past(at)) return json(req, 400, { error: 'at: ms, not in the future' });
    const times = b.times;
    if (times != null && !(Array.isArray(times) && times.length === eps.length && times.every(past))) return json(req, 400, { error: 'times: one ms per episode, not in the future' });
    return json(req, 200, await mark(uid, key, { season: (b.season ?? -1) as number, episodes: eps, watched: !!b.watched, approx, ...(at != null ? { at: Math.round(at as number) } : {}),
      ...(times ? { times: (times as number[]).map(Math.round) } : {}) }));
  }
  const m = p.match(/^\/watchlist\/([^/]+)$/);
  if (m && (method === 'PUT' || method === 'DELETE')) {
    let key = decodeURIComponent(m[1]);
    if (!KEY.test(key)) return json(req, 400, { error: 'bad key' });
    key = await canonKey(key);
    if (method === 'DELETE') { await q.run('delete from watchlist where user_id = ? and key = ?', uid, key); return json(req, 200, { ok: true }); }
    if (!await getTitle(key)) return json(req, 404, { error: 'unknown title' });
    await q.run('insert into watchlist (user_id, key, added_at) values (?, ?, ?) on conflict do nothing', uid, key, Date.now());
    return json(req, 200, { ok: true });
  }
  return null;
}

// a page route handed to internal() under its internal path
const asInternal = (url: URL, path: string) => { const u = new URL(url); u.pathname = path; return u; };

export async function handle(req: Request) {
  const url = new URL(req.url), p = url.pathname;
  try {
    return await route(req, url, p) || json(req, 404, { error: 'not found' });
  } catch (e) {
    // an address with a broken %-escape (decodeURIComponent) is the asker's mistake, not ours
    if (e instanceof URIError) return json(req, 400, { error: 'bad address' });
    console.error(e);
    // one alert per distinct error an hour, with where it happened; the reply says only that it failed, as the error can
    // name the database or an outside source
    await alert(`API error: ${msg(e).slice(0, 80)}`, `${req.method} ${p}\n${msg(e)}`);
    return json(req, 500, { error: 'something went wrong: try again' });
  }
}
async function route(req: Request, url: URL, p: string): Promise<Response | null> {
  let m: RegExpMatchArray | null;
  // the calendar feed, for a calendar app's subscription: opened by a calendar key in its address (calendar apps send no
  // headers). /api/calendar/ is its first address, which subscriptions made before v1 still use
  m = p.match(/^\/api\/(?:v1\/)?calendar\/([\w-]{10,128})\.ics$/);
  if (m && req.method === 'GET') {
    const who = await keyOf(m[1]);
    if (!who || !mayUse(who.app, 'calendar')) return json(req, await tooMany(req) ? 429 : 404, { error: 'no such calendar' });
    return new Response(await calendarOf(who.id), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=900' } });
  }
  // the public API, v1 (docs/api.md): read-only, for addons and other apps. A key (Authorization: Bearer <key>, made in
  // Settings › API access) opens the scopes of the app it was made for. Wrong keys count toward the same limit as sign-in
  // attempts
  if (p.startsWith('/api/v1/') && req.method === 'GET') {
    const who = await keyOf(String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim());
    if (!who) return json(req, await tooMany(req) ? 429 : 401, { error: 'wrong or missing key' });
    if (p === '/api/v1/me') return json(req, 200, { name: (await getUser(who.id))?.name || null, app: who.app });
    const scope = p.startsWith('/api/v1/lists') ? 'lists' : p.startsWith('/api/v1/stremio/') ? 'stremio' : null;
    if (scope && !mayUse(who.app, scope)) return json(req, 403, { error: `this key has no ${scope} scope` });
    if (p === '/api/v1/lists') return json(req, 200, { lists: await catalogSources(who.id) });
    m = p.match(/^\/api\/v1\/lists\/([^/]+)$/);
    if (m) {
      const s = url.searchParams, st = s.get('type') || '', type = ['movie', 'series', 'anime', FOR_YOU].includes(st) ? st : 'series';
      const items = await catalogList(decodeURIComponent(m[1]), type, Math.min(365, Math.max(1, Number(s.get('days')) || 60)), s.get('filter') || null, who.id, s.get('genre') || null);
      return items ? json(req, 200, { items }) : json(req, 404, { error: 'no such list' });
    }
    if (p === '/api/v1/stremio/meta') {
      const type = url.searchParams.get('type') === 'movie' ? 'movie' : 'series', meta = await stremioMeta(type, url.searchParams.get('id') || '');
      return meta ? json(req, 200, { meta }) : json(req, 404, { error: 'not found' });
    }
    if (p === '/api/v1/stremio/search') {
      const text = (url.searchParams.get('q') || '').trim().slice(0, 100);
      const st = url.searchParams.get('type') || '', type = ['movie', 'anime.series', 'anime.movie'].includes(st) ? st : 'series';
      return json(req, 200, { metas: text ? await stremioSearch(type, text) : [] });
    }
    return json(req, 404, { error: 'not found' });
  }
  // what the page needs to know before signing in: this instance's name, the captcha's site key, whether email works, whether
  // the weather shows; and which optional sources this instance has keys for, so About credits only those
  if (p === '/api/config' && req.method === 'GET') return json(req, 200, { name: appName(), captcha: captchaOn() ? env('TURNSTILE_SITE_KEY') : null, mail: mailOn(), weather: env('LISTICK_WEATHER') === 'on',
    sources: { mal: !!env('MAL_CLIENT_ID'), omdb: !!env('OMDB_API_KEY'), tvdb: !!env('TVDB_API_KEY') } });
  // the signed-out page's poster strip: the first posters of two shared rows, nothing of anyone's
  if (p === '/api/landing' && req.method === 'GET') return json(req, 200, { posters: await landingPosters() }, { 'cache-control': 'public, max-age=86400' });
  // ---- signing in ----
  if (p === '/api/session' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(req, 403, { error: 'origin' });
    const s = await sessionOf(req);
    if (s) return json(req, 200, { csrf: csrfOf(s.token), user: pubUser(s.user) });
    return json(req, 401, { error: 'sign in', setup: await noUsers() });
  }
  // a fresh instance's first visit makes the owner, once
  if (p === '/api/setup' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(req, 403, { error: 'origin' });
    if (await tooMany(req)) return json(req, 429, { error: 'too many tries: wait a few minutes' });
    const b = await body(req);
    if (!nameOk(b.name)) return json(req, 400, { error: 'a username of 2-30 letters, digits, . _ -' });
    if (!passOk(b.password)) return json(req, 400, { error: 'a password of at least 8 characters' });
    const made = await tx(async (t) => {
      await t.one('select pg_advisory_xact_lock(7701)');
      if (!await noUsers()) return false;
      await makeUser(b.name as string, placeholderEmail(b.name as string), b.password as string, true);
      return true;
    });
    if (!made) return json(req, 403, { error: 'already set up' });
    const s = await signIn(b.name, b.password);
    return s ? withCookies(json(req, 200, { csrf: csrfOf(s.token), user: pubUser((await getUser(s.uid))!) }), s.res) : json(req, 500, { error: 'made, but the sign-in failed: sign in' });
  }
  if (p === '/api/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(req, 403, { error: 'origin' });
    if (await tooMany(req)) return json(req, 429, { error: 'too many tries: wait a few minutes' });
    const b = await body(req);
    if (!await captchaOk(req, b.captcha)) return json(req, 403, { error: 'the captcha check failed: try again' });
    const s = await signIn(b.name, b.password);
    if (!s) return json(req, 403, { error: 'wrong name or password' });
    return withCookies(json(req, 200, { csrf: csrfOf(s.token), user: pubUser((await getUser(s.uid))!) }), s.res);
  }
  // sign-up is by an admin's invite link only (the owner comes from LISTICK_OWNER_*, owner.ts): GET checks a link, POST makes the
  // account and signs it in
  if (p === '/api/invite' && req.method === 'GET') { const ok = !!await liveInvite(url.searchParams.get('token')); return json(req, ok ? 200 : 404, { ok }); }
  if (p === '/api/register' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(req, 403, { error: 'origin' });
    if (await tooMany(req)) return json(req, 429, { error: 'too many tries: wait a few minutes' });
    const b = await body(req), inv = await liveInvite(b.invite);
    if (!inv) return json(req, 403, { error: b.invite ? 'this invite link is used or has run out: ask for a new one' : 'sign-up is by invite: ask for a link' });
    if (!await captchaOk(req, b.captcha)) return json(req, 403, { error: 'the captcha check failed: try again' });
    if (!firstOk(b.first)) return json(req, 400, { error: 'your first name' });
    if (!nameOk(b.name)) return json(req, 400, { error: 'username: 2-30 letters, digits, . _ -' });
    if (!emailOk(b.email)) return json(req, 400, { error: 'an email address' });
    if (!passOk(b.password)) return json(req, 400, { error: 'password: at least 8 characters' });
    if (await findLogin(b.name) || await findLogin(b.email)) return json(req, 409, { error: 'that username or email is taken' });
    const r = await auth.api.signUpEmail({ body: { email: b.email.trim(), password: b.password, name: b.first.trim(), username: b.name.trim(), displayUsername: b.name.trim(), callbackURL: VERIFIED }, asResponse: true });
    if (!r.ok) return json(req, 400, { error: (await r.json().catch(() => ({}))).message || 'sign-up failed' });
    const j: { token: string; user: { id: string } } = await r.clone().json();
    // the invite is taken here, once: of two sign-ups racing on one link, the second loses the account it just made
    if (!(await q.run('update invites set used_by = ?, used_at = ? where token = ? and used_at is null', j.user.id, Date.now(), inv.token)).changes) {
      await q.run('delete from "user" where id = ?', j.user.id);
      return json(req, 403, { error: 'this invite link is used or has run out: ask for a new one' });
    }
    await setProfile(j.user.id, { tracking_since: Date.now() });
    console.log(`users: ${b.name.trim()} signed up with an invite`);
    return withCookies(json(req, 200, { csrf: csrfOf(j.token), user: pubUser((await getUser(j.user.id))!) }), r);
  }
  // a forgotten password: a link by email, good for an hour. The answer is the same whether or not the address has an account
  if (p === '/api/forgot' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(req, 403, { error: 'origin' });
    if (await tooMany(req)) return json(req, 429, { error: 'too many tries: wait a few minutes' });
    const b = await body(req);
    if (!mailOn()) return json(req, 503, { error: "email isn't set up yet: ask an admin to reset it" });
    if (!await captchaOk(req, b.captcha)) return json(req, 403, { error: 'the captcha check failed: try again' });
    const id = emailOk(b.email) && await findLogin(b.email);
    const email = await emailOf(id);
    if (email) { await safe(() => auth.api.requestPasswordReset({ body: { email, redirectTo: '/' } })); console.log('users: reset link sent'); }
    return json(req, 200, { ok: true });
  }
  // a new password from a reset link; every device signs in again, this one included
  if (p === '/api/reset' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(req, 403, { error: 'origin' });
    const b = await body(req);
    if (!passOk(b.password)) return json(req, 400, { error: 'password: at least 8 characters' });
    const password = b.password;
    const ctx = await auth.$context, v = typeof b.token === 'string' && await ctx.internalAdapter.findVerificationValue(`reset-password:${b.token}`);
    const done = v && await auth.api.resetPassword({ body: { newPassword: password, token: b.token as string } }).catch(() => null);
    if (!v || !done) return json(req, 403, { error: 'this link is used or has run out: ask for a new one' });
    const email = await emailOf(v.value);
    const s = await signIn(email, password);
    if (!s) return json(req, 403, { error: 'sign in with your new password' });
    return withCookies(json(req, 200, { csrf: csrfOf(s.token), user: pubUser((await getUser(s.uid))!) }), s.res);
  }
  if (p === '/api/logout') {
    const g = await guard(req); if (g.error) return g.error;
    const r = await auth.api.signOut({ headers: req.headers, asResponse: true });
    return withCookies(json(req, 200, { ok: true }), r);
  }
  // ---- your account ----
  if (p === '/api/account' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, await account(g.user.id)); }
  if (p === '/api/account/password') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (!passOk(b.next)) return json(req, 400, { error: 'new password: at least 8 characters' });
    // other devices sign in again with the new one
    const r = await auth.api.changePassword({ body: { currentPassword: String(b.current || ''), newPassword: b.next, revokeOtherSessions: true }, headers: req.headers, asResponse: true });
    if (!r.ok) return json(req, 403, { error: 'current password is wrong' });
    return withCookies(json(req, 200, { ok: true }), r);
  }
  // your username: what you sign in with, one per person
  if (p === '/api/account/username') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (!nameOk(b.name)) return json(req, 400, { error: 'username: 2-30 letters, digits, . _ -' });
    const other = await findLogin(b.name);
    if (other && other !== g.user.id) return json(req, 409, { error: 'that username is taken' });
    await q.run('update "user" set username = lower(?), display_username = ?, updated_at = now() where id = ?', b.name.trim(), b.name.trim(), g.user.id);
    return json(req, 200, await account(g.user.id));
  }
  // an API key for one app: what that app reads your data with. Made only when asked for; a new one replaces the old,
  // which stops working
  m = p.match(/^\/api\/account\/apikey\/([\w-]+)$/);
  if (m) {
    const g = await guard(req); if (g.error) return g.error;
    const addon = m[1];
    if (!APPS.some((x) => x.id === addon)) return json(req, 404, { error: 'no such app' });
    await q.run(`insert into api_keys (user_id, addon, token, created_at) values (?, ?, ?, ?)
      on conflict (user_id, addon) do update set token = excluded.token, created_at = excluded.created_at`, g.user.id, addon, crypto.randomBytes(18).toString('base64url'), Date.now());
    return json(req, 200, await account(g.user.id));
  }
  // your name (the greeting only)
  if (p === '/api/account/first') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (!firstOk(b.first)) return json(req, 400, { error: 'a first name, up to 40 characters' });
    await q.run('update "user" set name = ?, updated_at = now() where id = ?', b.first.trim(), g.user.id);
    return json(req, 200, await account(g.user.id));
  }
  // your email (for a forgotten password); changing it takes your password
  if (p === '/api/account/email') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (!await checkPass(g.user.id, b.password)) return json(req, 403, { error: 'password is wrong' });
    if (!emailOk(b.email)) return json(req, 400, { error: 'an email address' });
    const other = await findLogin(b.email);
    if (other && other !== g.user.id) return json(req, 409, { error: 'that email is taken' });
    const email = b.email.trim(), changed = email.toLowerCase() !== (g.user.email || '').toLowerCase();
    await q.run('update "user" set email = ?, email_verified = email_verified and not ?, updated_at = now() where id = ?', email, changed && mailOn(), g.user.id);
    // a new address gets a confirmation link; you stay signed in here, and a sign-in elsewhere waits for it
    if (changed && mailOn()) await safe(() => auth.api.sendVerificationEmail({ body: { email, callbackURL: VERIFIED } }));
    return json(req, 200, await account(g.user.id));
  }
  // Stremio: { email, password } signs in to Stremio, { key } takes a session key as it is, { disconnect: true } forgets it
  if (p === '/api/account/stremio') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    let key: string | null = null, who: string | null = null;
    if (b.disconnect !== true) {
      if (typeof b.key === 'string' && /^[\w-]{20,200}$/.test(b.key.trim())) { key = b.key.trim(); who = 'connected (key)'; }
      else if (typeof b.email === 'string' && typeof b.password === 'string' && b.email.includes('@')) {
        try { key = await stremioLogin(b.email.trim(), b.password); who = b.email.trim(); } catch (e) { return json(req, 403, { error: msg(e) }); }
      } else return json(req, 400, { error: 'email and password, or a session key' });
    }
    await setProfile(g.user.id, { stremio_key: key, stremio_user: who });
    await forgetSource(g.user.id, ['stremio', 'cw-hide']);
    await forgetLive(g.user.id);
    return json(req, 200, await account(g.user.id));
  }
  // everything Listick keeps about you, as a file
  if (p === '/api/account/export' && req.method === 'GET') {
    const g = await reader(req); if (g.error) return g.error;
    return json(req, 200, await exportOf(g.user.id), { 'content-disposition': `attachment; filename="listick-export-${new Date().toISOString().slice(0, 10)}.json"` });
  }
  // your account and everything in it, for good (your password confirms it); the owner's stays
  if (p === '/api/account/delete') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (!await checkPass(g.user.id, b.password)) return json(req, 403, { error: 'password is wrong' });
    if (g.user.id === await ownerId()) return json(req, 403, { error: "the owner's account stays" });
    const r = await auth.api.signOut({ headers: req.headers, asResponse: true });
    await q.run('delete from "user" where id = ?', g.user.id);
    console.log(`users: ${g.user.name} deleted their account`);
    return withCookies(json(req, 200, { ok: true }), r);
  }
  // ---- bringing your history from another service, or starting fresh ----
  // what can be imported, the runs so far, and whether to offer it (a new account with no history that hasn't chosen yet)
  if (p === '/api/import' && req.method === 'GET') {
    const g = await reader(req); if (g.error) return g.error;
    const uid = g.user.id, runs = await importsOf(uid);
    const onboard = !runs.length && !await getState(uid, 'onboarding', 'done') && !await q.one('select 1 from history where user_id = ? limit 1', uid);
    // each source: its export file to upload (Kitsu: your username; its library is read from Kitsu)
    return json(req, 200, { onboard, runs, sources: [
      { id: 'trakt', name: 'Trakt', what: 'History, ratings and watchlist: your export .zip', file: '.zip' },
      { id: 'simkl', name: 'Simkl', what: 'Movies, shows and anime: your backup (.zip with .json)', file: '.zip,.json' },
      { id: 'letterboxd', name: 'Letterboxd', what: 'Films: the .zip from Settings › Data › Export', file: '.zip' },
      { id: 'mal', name: 'MyAnimeList', what: 'Anime: the .xml.gz from Profile › Export', file: '.xml,.gz' },
      { id: 'anilist', name: 'AniList', what: 'Anime: your list as MyAnimeList XML (an AniList exporter makes it)', file: '.xml,.gz' },
      { id: 'kitsu', name: 'Kitsu', what: 'Anime: your public library, by your Kitsu username', file: '', user: true },
    ] });
  }
  // an export file, sent as base64 JSON ({ data }): read here into rows, imported by the worker
  m = p.match(/^\/api\/import\/file\/(trakt|simkl|letterboxd|mal|anilist)$/);
  if (m) {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (typeof b.data !== 'string' || b.data.length > 40_000_000) return json(req, 400, { error: 'a file up to 30 MB' });
    const buf = Buffer.from(b.data, 'base64');
    const source = m[1] as 'trakt' | 'simkl' | 'letterboxd' | 'mal' | 'anilist';
    let payload, n;
    try {
      if (source === 'trakt') { const t = traktExport(unzip(buf)); payload = { trakt: t }; n = t.history.length + t.ratings.length + t.watchlist.length; }
      else if (source === 'simkl') { const s = simklExport(buf); payload = { simkl: s }; n = s.movies.length + s.shows.length + s.anime.length; }
      else if (source === 'letterboxd') { const films = letterboxd(unzip(buf)); payload = { films }; n = films.length; }
      else { const anime = malXml(buf, source === 'anilist'); payload = { anime }; n = anime.length; }
    } catch (e) {
      return json(req, 400, { error: source === 'letterboxd' ? "that isn't Letterboxd's export: upload the .zip from Settings › Data › Export"
        : source === 'trakt' ? `that isn't Trakt's export (${msg(e)}): upload the .zip from Settings › Data` : msg(e) });
    }
    if (!n) return json(req, 400, { error: 'nothing to import in that file' });
    const id = await queueImport(g.user.id, source, payload);
    await setState(g.user.id, 'onboarding', 'done', { at: Date.now(), choice: m[1] });
    return json(req, 200, { id, entries: n });
  }
  // Kitsu: your public library, read from Kitsu by your username ({ user })
  if (p === '/api/import/kitsu') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (typeof b.user !== 'string' || !b.user.trim()) return json(req, 400, { error: 'your Kitsu username' });
    let anime;
    try { anime = await kitsuLibrary(b.user); } catch (e) { return json(req, 400, { error: msg(e) }); }
    if (!anime.length) return json(req, 400, { error: 'nothing to import: that library is empty or private' });
    const id = await queueImport(g.user.id, 'kitsu', { anime });
    await setState(g.user.id, 'onboarding', 'done', { at: Date.now(), choice: 'kitsu' });
    return json(req, 200, { id, entries: anime.length });
  }
  // starting fresh: the offer isn't made again (imports stay in Account › Your data)
  if (p === '/api/import/fresh') {
    const g = await guard(req); if (g.error) return g.error;
    await setState(g.user.id, 'onboarding', 'done', { at: Date.now(), choice: 'fresh' });
    return json(req, 200, { ok: true });
  }
  // ---- users (admins) ----
  if (p === '/api/users' && req.method === 'GET') {
    const g = await reader(req); if (g.error) return g.error;
    if (!g.user.admin) return json(req, 403, { error: 'admins only' });
    const plays = Object.fromEntries((await q.all<{ user_id: string; n: number }>('select user_id, count(*) n from history group by user_id')).map((r) => [r.user_id, r.n]));
    const owner = await ownerId();
    return json(req, 200, { users: (await allUsers()).map((x) => ({ ...pubUser(x), email: x.email || null, created: x.created_at, stremio: !!x.stremio_key,
      plays: plays[x.id] || 0, owner: x.id === owner, you: x.id === g.user.id })) });
  }
  if (p === '/api/users' && req.method === 'POST') {
    const g = await guard(req); if (g.error) return g.error;
    if (!g.user.admin) return json(req, 403, { error: 'admins only' });
    const b = await body(req);
    if (!nameOk(b.name)) return json(req, 400, { error: 'name: 2-30 letters, digits, . _ -' });
    if (!emailOk(b.email)) return json(req, 400, { error: 'an email address' });
    if (!passOk(b.password)) return json(req, 400, { error: 'password: at least 8 characters' });
    if (await findLogin(b.name) || await findLogin(b.email)) return json(req, 409, { error: 'that name or email is taken' });
    await makeUser(b.name.trim(), b.email.trim(), b.password, !!b.admin);   // made by an admin: no confirmation, no session
    console.log(`users: ${g.user.name} added ${b.name}`);
    return json(req, 200, { ok: true });
  }
  // an invite link (admins): one sign-up, within 7 days
  // the invites made (newest first, the last 30): when, until when, and who used it; a link shows only once, when made, as
  // only its hash is kept (which is also its id here)
  if (p === '/api/invites' && req.method === 'GET') {
    const g = await reader(req); if (g.error) return g.error;
    if (!g.user.admin) return json(req, 403, { error: 'admins only' });
    const rows = await q.all<Invite & { used_name: string | null; by_name: string | null }>(`select i.*, u.username used_name, c.username by_name from invites i
      left join "user" u on u.id = i.used_by left join "user" c on c.id = i.created_by order by i.created_at desc limit 30`);
    return json(req, 200, { invites: rows.map((r) => ({ id: r.token, created: r.created_at, expires: r.expires, by: r.by_name, usedBy: r.used_name, usedAt: r.used_at,
      open: !r.used_at && r.expires > Date.now() })) });
  }
  // an unused invite taken back: its link stops working
  m = p.match(/^\/api\/invites\/([0-9a-f]{64})\/revoke$/);
  if (m && req.method === 'POST') {
    const g = await guard(req); if (g.error) return g.error;
    if (!g.user.admin) return json(req, 403, { error: 'admins only' });
    await q.run('delete from invites where token = ? and used_at is null', m[1]);
    return json(req, 200, { ok: true });
  }
  if (p === '/api/invites' && req.method === 'POST') {
    const g = await guard(req); if (g.error) return g.error;
    if (!g.user.admin) return json(req, 403, { error: 'admins only' });
    const token = crypto.randomBytes(24).toString('base64url');
    await q.run('insert into invites (token, created_by, created_at, expires) values (?, ?, ?, ?)', sha(token), g.user.id, Date.now(), Date.now() + INVITE_MS);
    return json(req, 200, { link: `${LINK_ORIGIN()}/?invite=${token}`, expires: Date.now() + INVITE_MS });
  }
  m = p.match(/^\/api\/users\/([\w-]+)\/(password|delete)$/);
  if (m) {
    const g = await guard(req); if (g.error) return g.error;
    if (!g.user.admin) return json(req, 403, { error: 'admins only' });
    const x = await getUser(m[1]);
    if (!x) return json(req, 404, { error: 'no such user' });
    if (m[2] === 'password') {
      const b = await body(req);
      if (!passOk(b.password)) return json(req, 400, { error: 'password: at least 8 characters' });
      const ctx = await auth.$context;
      await ctx.internalAdapter.updatePassword(x.id, await ctx.password.hash(b.password));
      await q.run('delete from session where user_id = ?', x.id);
      return json(req, 200, { ok: true });
    }
    // the owner and yourself stay; everything the user had goes with them (cascade)
    if (x.id === await ownerId() || x.id === g.user.id) return json(req, 403, { error: 'the owner and your own account stay' });
    await q.run('delete from "user" where id = ?', x.id);
    console.log(`users: ${g.user.name} removed ${x.name}`);
    return json(req, 200, { ok: true });
  }
  // ---- your data ----
  // your country and services (Settings › Region & services); the countries, and one country's services and age ratings
  if (p === '/api/region' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, { countries: await countries(), ...await prefsOf(g.user.id) }); }
  if (p === '/api/region' && req.method === 'POST') {
    const g = await guard(req); if (g.error) return g.error;
    const r = await setPrefs(g.user.id, await body(req));
    return 'error' in r ? json(req, 400, r) : json(req, 200, r);
  }
  m = p.match(/^\/api\/region\/([A-Z]{2})$/);
  if (m && req.method === 'GET') { const g = await reader(req); if (g.error) return g.error; return (await isCountry(m[1])) ? json(req, 200, await regionOf(m[1])) : json(req, 404, { error: 'no such country' }); }
  // Lists: yours and the built-in ones; one with its titles; Add to list's ticks; the builder's preview; and the changes
  if (p === '/api/lists' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, await listsOf(g.user.id)); }
  if (p === '/api/lists/search' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, { results: await pickSearch(url.searchParams.get('kind') || '', url.searchParams.get('q') || '') }); }
  if (p === '/api/lists/options' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, await options()); }
  if (p === '/api/lists/rows' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, { rows: await rowLists(g.user.id) }); }
  if (p === '/api/lists/membership' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, await membership(g.user.id, url.searchParams.get('key') || '')); }
  m = p.match(/^\/api\/lists\/([\w-]{4,20})$/);
  if (m && req.method === 'GET' && isBuiltin(m[1])) { const g = await reader(req); return g.error || json(req, 200, await builtinOf(g.user.id, m[1])); }
  if (m && req.method === 'GET') { const g = await reader(req); if (g.error) return g.error; const l = await listOf(g.user.id, m[1]); return l ? json(req, 200, l) : json(req, 404, { error: 'no such list' }); }
  if (p === '/api/lists/preview') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (!MEDIA.includes(b.media as Media)) return json(req, 400, { error: 'a kind: movies, shows, anime or both' });
    return json(req, 200, await preview(g.user.id, b.media as Media, (b.filters || {}) as Filters));
  }
  if (p === '/api/lists/new') {
    const g = await guard(req); if (g.error) return g.error;
    const r = await createList(g.user.id, await body(req));
    return 'error' in r ? json(req, 400, r) : json(req, 200, r);
  }
  m = p.match(/^\/api\/lists\/([\w-]{6,20})\/(edit|refresh|delete|item|follow|copy)$/);
  if (m) {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req), uid = g.user.id;
    if (m[2] === 'follow' || m[2] === 'copy') { const r = m[2] === 'follow' ? await follow(uid, m[1], b.on !== false) : await copyList(uid, m[1]); return 'error' in r ? json(req, 400, r) : json(req, 200, r); }
    if (m[2] === 'delete') { await deleteList(uid, m[1]); return json(req, 200, { ok: true }); }
    if (m[2] === 'refresh') { await refreshList(uid, m[1]); return json(req, 200, { ok: true }); }
    const r = m[2] === 'edit' ? await updateList(uid, m[1], b) : await setItem(uid, m[1], String(b.key || ''), !!b.on);
    return 'error' in r ? json(req, 400, r) : json(req, 200, r);
  }
  // Stats: ?period=12m (default), a year (2026) or all
  if (p === '/api/stats' && req.method === 'GET') {
    const g = await reader(req); if (g.error) return g.error;
    const per = url.searchParams.get('period') || '12m';
    if (!/^(12m|all|\d{4})$/.test(per)) return json(req, 400, { error: 'period: 12m, all or a year' });
    return json(req, 200, await statsOf(g.user.id, per as Period));
  }
  if (p === '/api/summary' && req.method === 'GET') { const g = await reader(req); return g.error || json(req, 200, await pageData(g.user.id, url.searchParams)); }
  // title details, id resolving, search and a row in full: read-only
  m = p.match(/^\/api\/(title\/[^/]+(?:\/season\/\d+)?|resolve|search|shelf|row\/[\w-]+|hero\/(?:movie|tv|anime))$/);
  if (m && req.method === 'GET') { const g = await reader(req); if (g.error) return g.error; return internal(req, asInternal(url, `/${m[1]}`), 'GET', g.user.id); }
  // your marks and ratings (episodes or a movie watched / not, a rating 1-10), and the watchlist
  if (p === '/api/hide-continue') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (typeof b.id !== 'string' || !Number.isFinite(b.at)) return json(req, 400, { error: 'id, video, at' });
    await setState(g.user.id, 'cw-hide', `${b.id}|${b.video || ''}`, { at: b.at });
    return json(req, 200, { ok: true });
  }
  if (p === '/api/dismiss') {
    const g = await guard(req); if (g.error) return g.error;
    const b = await body(req);
    if (typeof b.key !== 'string' || !KEY.test(b.key)) return json(req, 400, { error: 'key' });
    await setState(g.user.id, 'fy-hide', b.key, { at: Date.now() });
    return json(req, 200, { ok: true });
  }
  m = p.match(/^\/api\/(mark|rate|retime)\/([^/]+)$/);
  if (m) { const g = await guard(req); if (g.error) return g.error; return internal(req, asInternal(url, `/${m[1]}/${m[2]}`), 'POST', g.user.id); }
  m = p.match(/^\/api\/watchlist\/(add|remove)\/([^/]+)$/);
  if (m) { const g = await guard(req); if (g.error) return g.error; return internal(req, asInternal(url, `/watchlist/${m[2]}`), m[1] === 'add' ? 'PUT' : 'DELETE', g.user.id); }
  return null;
}
