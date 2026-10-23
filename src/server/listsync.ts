// Anime progress to AniList and MyAnimeList: one way, on Sync, only ever raised.
import crypto from 'node:crypto';
import { q } from './db';
import { anilistOf, fribb, loadFribb } from './mapping';
import { fetchCounted } from './sources';
import { getState, setState } from './store';
import { env, HOUR, msg, netErr } from './util';

export type Provider = 'anilist' | 'mal';
export const PROVIDERS: Provider[] = ['anilist', 'mal'];
type Pending = { provider: Provider; verifier?: string; exp: number };
type Token = { access: string; refresh?: string; expires: number; user: string; id?: number };
type OAuthToken = { access_token: string; refresh_token?: string; expires_in: number };
type Span = { first: number; last: number };
type Want = { anilist: number; mal: number | null; eps: Map<number, Span> };
type Desired = { anilist: number; mal: number | null; title: string | null; progress: number; total: number | null; done: boolean; started: number; finished: number };
type Write = { id: number; title: string | null; progress: number; status: 'completed' | 'watching'; started: string | null; completed: string | null };
type Current = { progress?: number; num_episodes_watched?: number; status: string; startedAt?: { year: number | null }; start_date?: string };
type Last = { at: number; wrote: number; error?: string };
type ListStatus = { user: string | null; expired: boolean; running: boolean; last: Last | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (ms: number) => new Date(ms).toLocaleDateString('sv-SE');
const fuzzy = (d: string) => ({ year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) });
export const configured = (p: Provider) => (p === 'anilist' ? !!(env('ANILIST_CLIENT_ID') && env('ANILIST_CLIENT_SECRET')) : !!env('MAL_CLIENT_ID'));
const redirect = (p: Provider) => `${env('APP_ORIGIN').split(',')[0].trim()}/api/lists/done/${p}`;

async function call<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetchCounted(url, { ...opts, signal: AbortSignal.timeout(15000) })
    .catch((e) => { throw new Error(`${new URL(url).host}: ${netErr(e)}`); });
  const text = await r.text();
  if (!r.ok) throw new Error(`${url.split('?')[0]} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : ({} as T);
}
const gql = <T>(query: string, variables: Record<string, unknown>, token?: string) => call<T>('https://graphql.anilist.co', { method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ query, variables }) });
const form = (o: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));

const tokenOf = (uid: string, p: Provider) => getState<Token>(uid, 'oauth', p);
const saveToken = (uid: string, p: Provider, t: Token) => setState(uid, 'oauth', p, t);

// ---------- connecting ----------
// the user whose connect made this state
export const pendingUser = async (state: string) => (await q.one<{ user_id: string }>(`select user_id from sync_state where source = 'oauth-pending' and item = ?
  and (state->>'exp')::bigint > ?`, state, Date.now()))?.user_id || null;

export async function connectUrl(uid: string, p: Provider) {
  if (!configured(p)) return null;
  const state = crypto.randomBytes(16).toString('base64url');
  if (p === 'anilist') {
    await setState(uid, 'oauth-pending', state, { provider: p, exp: Date.now() + 600000 } satisfies Pending);
    return `https://anilist.co/api/v2/oauth/authorize?${form({ client_id: env('ANILIST_CLIENT_ID'), redirect_uri: redirect(p), response_type: 'code', state })}`;
  }
  // PKCE plain
  const verifier = crypto.randomBytes(48).toString('base64url');
  await setState(uid, 'oauth-pending', state, { provider: p, verifier, exp: Date.now() + 600000 } satisfies Pending);
  return `https://myanimelist.net/v1/oauth2/authorize?${form({ response_type: 'code', client_id: env('MAL_CLIENT_ID'), redirect_uri: redirect(p), state, code_challenge: verifier, code_challenge_method: 'plain' })}`;
}

export async function finishConnect(uid: string, p: Provider, code: string | null, state: string) {
  const s = await getState<Pending>(uid, 'oauth-pending', state);
  await q.run(`delete from sync_state where user_id = ? and source = 'oauth-pending' and (item = ? or (state->>'exp')::bigint < ?)`, uid, state, Date.now());
  if (!s || s.provider !== p || s.exp < Date.now() || !code) throw new Error('sign-in expired: connect again');
  if (p === 'anilist') {
    const t = await call<OAuthToken>('https://anilist.co/api/v2/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', client_id: env('ANILIST_CLIENT_ID'), client_secret: env('ANILIST_CLIENT_SECRET'), redirect_uri: redirect(p), code }) });
    const me = await gql<{ data: { Viewer: { id: number; name: string } } }>('query{Viewer{id name}}', {}, t.access_token);
    await saveToken(uid, p, { access: t.access_token, expires: Date.now() + t.expires_in * 1000, user: me.data.Viewer.name, id: me.data.Viewer.id });
    return me.data.Viewer.name;
  }
  const t = await call<OAuthToken>('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: env('MAL_CLIENT_ID'), client_secret: env('MAL_CLIENT_SECRET'), grant_type: 'authorization_code', code, redirect_uri: redirect(p), code_verifier: s.verifier }) });
  const me = await call<{ name: string }>('https://api.myanimelist.net/v2/users/@me', { headers: { authorization: `Bearer ${t.access_token}` } });
  await saveToken(uid, p, { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + t.expires_in * 1000, user: me.name });
  return me.name;
}

export const disconnect = (uid: string, p: Provider) =>
  q.run("delete from sync_state where user_id = ? and ((source = 'oauth' and item = ?) or (source = 'lists-last' and item = ?))", uid, p, p);

// AniList: a year, no refresh; MAL: renewed from its refresh token
async function accessToken(uid: string, p: Provider) {
  const t = await tokenOf(uid, p);
  if (!t) return null;
  if (p === 'anilist') return t.expires > Date.now() ? t.access : null;
  if (t.expires - Date.now() > 2 * 24 * HOUR) return t.access;
  const n = await call<OAuthToken>('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: env('MAL_CLIENT_ID'), client_secret: env('MAL_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: t.refresh }) });
  await saveToken(uid, 'mal', { ...t, access: n.access_token, refresh: n.refresh_token, expires: Date.now() + n.expires_in * 1000 });
  return n.access_token;
}

// ---------- what the History says ----------
type MediaInfo = { episodes: number | null; idMal: number | null; title: string; sequel: { id: number; mal: number | null } | null };
const media = new Map<number, { at: number; m: MediaInfo }>();
async function mediaInfo(ids: number[]) {
  const want = [...new Set(ids)].filter((i) => !(Date.now() - (media.get(i)?.at || 0) < 24 * HOUR));
  type Media = { id: number; idMal: number | null; episodes: number | null; title: { romaji: string }; relations: { edges: { relationType: string; node: { id: number; idMal: number | null; format: string } }[] } };
  for (let i = 0; i < want.length; i += 50) {
    const r = await gql<{ data: { Page: { media: Media[] } } }>(`query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id idMal episodes title{romaji}
      relations{edges{relationType node{id idMal format}}}}}}`, { ids: want.slice(i, i + 50) });
    for (const m of r.data.Page.media) {
      const seq = m.relations.edges.find((e) => e.relationType === 'SEQUEL' && ['TV', 'TV_SHORT', 'ONA'].includes(e.node.format))?.node;
      media.set(m.id, { at: Date.now(), m: { episodes: m.episodes, idMal: m.idMal, title: m.title.romaji, sequel: seq ? { id: seq.id, mal: seq.idMal } : null } });
    }
    if (i + 50 < want.length) await sleep(1500);
  }
}
const malOf = (anilist: number) => { const k = fribb.byAnilist.get(anilist); return (k && fribb.map.get(k)?.mal) || null; };

async function desired(uid: string): Promise<Desired[]> {
  await loadFribb();
  const rows = await q.all<{ key: string; se: number; ep: number; first: number; last: number }>(`select h.key, h.season se, h.episode ep, min(h.watched_at) first,
    max(h.watched_at) last from history h join titles t using (key) where h.user_id = ? and (t.anime = 1 or t.type = 'anime') group by h.key, h.season, h.episode`, uid);
  const want = new Map<number, Want>();
  const add = (w: Want, ep: number, t: Span) => { const o = w.eps.get(ep); w.eps.set(ep, o ? { first: Math.min(o.first, t.first), last: Math.max(o.last, t.last) } : t); };
  const put = (id: number, ep: number, t: Span) => { const w = want.get(id) || { anilist: id, mal: malOf(id), eps: new Map() }; add(w, ep, t); want.set(id, w); };
  for (const r of rows) {
    const film = r.key.startsWith('tmdb:movie:');
    if (!film && (r.se < 1 || r.ep < 1)) continue;
    const a = await anilistOf(r.key, film ? -1 : r.se, film ? -1 : r.ep);
    if (a) put(a.id, film ? 1 : a.ep, { first: Number(r.first), last: Number(r.last) });
  }
  // episodes past an entry's end go to its sequel
  for (let round = 0; round < 5; round++) {
    await mediaInfo([...want.keys()]);
    let moved = false;
    for (const w of [...want.values()]) {
      const m = media.get(w.anilist)?.m;
      if (!m?.episodes) continue;
      const total = m.episodes, over = [...w.eps].filter(([e]) => e > total);
      if (!over.length) continue;
      for (const [e] of over) w.eps.delete(e);
      if (!m.sequel) continue;
      const s = want.get(m.sequel.id) || { anilist: m.sequel.id, mal: m.sequel.mal, eps: new Map() };
      for (const [e, t] of over) add(s, e - total, t);
      want.set(m.sequel.id, s); moved = true;
    }
    if (!moved) break;
  }
  return [...want.values()].filter((w) => w.eps.size).map((w) => {
    const m = media.get(w.anilist)?.m, progress = Math.max(...w.eps.keys()), total = m?.episodes || null, spans = [...w.eps.values()];
    return { anilist: w.anilist, mal: w.mal || m?.idMal || null, title: m?.title || null, progress, total, done: !!total && progress >= total,
      started: Math.min(...spans.map((x) => x.first)), finished: Math.max(...spans.map((x) => x.last)) };
  });
}

// ---------- the lists as they are, and writing ----------
async function listNow(uid: string, p: Provider, token: string) {
  const cur = new Map<number, Current>();
  if (p === 'anilist') {
    type Lists = { data: { MediaListCollection: { lists: { entries: { mediaId: number; progress: number; status: string }[] }[] } } };
    const r = await gql<Lists>('query($u:Int){MediaListCollection(userId:$u,type:ANIME){lists{entries{mediaId progress status startedAt{year}}}}}', { u: (await tokenOf(uid, p))?.id }, token);
    for (const l of r.data.MediaListCollection.lists) for (const e of l.entries) cur.set(e.mediaId, e);
    return cur;
  }
  let url: string | null = 'https://api.myanimelist.net/v2/users/@me/animelist?fields=list_status&limit=1000&nsfw=true';
  while (url) {
    const r: { data: { node: { id: number }; list_status: Current }[]; paging?: { next?: string } } = await call(url, { headers: { authorization: `Bearer ${token}` } });
    for (const x of r.data) cur.set(x.node.id, x.list_status);
    url = r.paging?.next || null;
  }
  return cur;
}
const FINISHED = { anilist: ['COMPLETED', 'REPEATING'], mal: ['completed'] };
// higher progress or Completed only; finished entries untouched
function plan(p: Provider, want: Desired[], cur: Map<number, Current>) {
  const out: Write[] = [];
  for (const w of want) {
    const id = p === 'anilist' ? w.anilist : w.mal;
    if (!id) continue;
    const c = cur.get(id), have = (p === 'anilist' ? c?.progress : c?.num_episodes_watched) ?? 0;
    if (c && (FINISHED[p].includes(c.status) || have > w.progress || (have === w.progress && !w.done))) continue;
    const hasStart = p === 'anilist' ? !!c?.startedAt?.year : !!c?.start_date;
    out.push({ id, title: w.title, progress: w.progress, status: w.done ? 'completed' : 'watching', started: hasStart ? null : day(w.started), completed: w.done ? day(w.finished) : null });
  }
  return out;
}
export const WAIT = { anilist: 2500, mal: 1000 };
async function write(p: Provider, x: Write, token: string) {
  if (p === 'anilist') {
    const dates = [x.started && 'startedAt:$sa', x.completed && 'completedAt:$ca'].filter(Boolean).join(',');
    await gql(`mutation($id:Int,$p:Int,$s:MediaListStatus${x.started ? ',$sa:FuzzyDateInput' : ''}${x.completed ? ',$ca:FuzzyDateInput' : ''}){SaveMediaListEntry(mediaId:$id,progress:$p,status:$s${dates ? `,${dates}` : ''}){id}}`,
      { id: x.id, p: x.progress, s: x.status === 'completed' ? 'COMPLETED' : 'CURRENT', ...(x.started ? { sa: fuzzy(x.started) } : {}), ...(x.completed ? { ca: fuzzy(x.completed) } : {}) }, token);
    return sleep(WAIT.anilist);
  }
  await call(`https://api.myanimelist.net/v2/anime/${x.id}/my_list_status`, { method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ status: x.status, num_watched_episodes: x.progress, start_date: x.started, finish_date: x.completed }) });
  return sleep(WAIT.mal);
}
const running = new Set<string>();
export async function sync(uid: string, p: Provider) {
  const id = `${uid}:${p}`;
  if (running.has(id)) return;
  running.add(id);
  let wrote = 0;
  try {
    const token = await accessToken(uid, p);
    if (!token) throw new Error('not connected');
    for (const x of plan(p, await desired(uid), await listNow(uid, p, token))) {
      await write(p, x, token); wrote++;
      console.log(`lists: ${p} ${x.title || x.id} -> ${x.progress} ${x.status}`);
    }
    await setState(uid, 'lists-last', p, { at: Date.now(), wrote } satisfies Last);
  } catch (e) {
    console.error(`lists: ${p}: ${msg(e)}`);
    await setState(uid, 'lists-last', p, { at: Date.now(), wrote, error: msg(e).slice(0, 200) } satisfies Last);
  } finally { running.delete(id); }
}

export async function listStatus(uid: string, p: Provider): Promise<ListStatus> {
  const t = await tokenOf(uid, p);
  return { user: t?.user || null, expired: !!t && p === 'anilist' && t.expires <= Date.now(), running: running.has(`${uid}:${p}`), last: await getState<Last>(uid, 'lists-last', p) };
}
