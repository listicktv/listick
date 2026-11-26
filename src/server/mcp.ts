// The MCP server (POST /api/v1/mcp, docs/api.md): a user's Listick for AI assistants, opened by an "AI assistant (MCP)" key.
// Titles, search, marks, ratings and the watchlist go through internal() (the page's own routes), lists, history and stats
// through the functions the page uses, so what an assistant can read and change is checked in the same places.
// Answers are the page's JSON without images or empty fields, times as ISO 8601
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { builtinOf, createList, isBuiltin, listOf, listsOf, setItem } from './lists';
import { canonKey } from './mapping';
import { historyPage, upNextOf } from './page';
import { statsOf, type Period } from './stats';
import { KEY } from './titles';

// api.ts's internal(): a page route by its internal path, for one user
export type Internal = (req: Request, url: URL, method: string, uid: string) => Promise<Response | null>;

const IMAGES = new Set(['poster', 'posters', 'backdrop', 'photo', 'logo', 'still']);
const TIMES = new Set(['at', 'lastAt', 'airedAt', 'added_at', 'changedAt', 'start']);
function lean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(lean);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k, x]) => x != null && !IMAGES.has(k))
    .map(([k, x]) => [k, TIMES.has(k) && typeof x === 'number' && x > 0 ? new Date(x).toISOString() : lean(x)]));
}
const ok = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(lean(v)) }] });
const fail = (error: string): CallToolResult => ({ content: [{ type: 'text', text: error }], isError: true });

const key = z.string().regex(KEY).describe("a title's key from search, e.g. tmdb:movie:603, tmdb:tv:1399 or kitsu:anime:1");
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = (destructive: boolean) => ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: true, openWorldHint: false });
const ASKED = ' Only when the user asks for it, never on your own.';

function server(uid: string, internal: Internal) {
  // a page route: its JSON, or its error as the tool's error
  const page = async (method: string, path: string, body?: unknown) => {
    const url = new URL(path, 'http://listick.internal');
    const res = await internal(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } }), url, method, uid);
    const data = res ? await res.json().catch(() => null) : null;
    return !res || res.status >= 400 ? { error: String(data?.error || `failed (${res?.status ?? 404})`) } : { data };
  };
  const answer = (r: { error?: string; data?: unknown }) => (r.error ? fail(r.error) : ok(r.data));
  const s = new McpServer({ name: 'listick', version: '1' });

  s.registerTool('search', {
    description: 'Find movies, shows and anime by name. Each result has its key (used by every other tool), year, rating, and whether you have it on Plan to watch, watched it (plays) or rated it (mine).',
    inputSchema: z.object({ query: z.string().min(2).max(100) }), annotations: READ,
  }, async ({ query }) => answer(await page('GET', `/search?q=${encodeURIComponent(query)}`)));

  s.registerTool('title', {
    description: "A title's details: overview, genres, runtime, release, status, seasons, cast, scores, your plays and rating. With season, that season's episodes and which you watched.",
    inputSchema: z.object({ key, season: z.number().int().min(0).optional() }), annotations: READ,
  }, async ({ key: k, season }) => {
    const r = await page('GET', `/title/${encodeURIComponent(k)}${season == null ? '' : `/season/${season}`}`);
    if (r.data && typeof r.data === 'object' && 'watch' in r.data) delete (r.data as { watch?: unknown }).watch;   // provider ids, meaningless without the page
    return answer(r);
  });

  s.registerTool('history', {
    description: 'Your plays, newest first. season and episode are -1 for a movie. approx 1: watched on an unknown date (at is a stand-in, not when); approx 2: an estimated time. Pass next back as cursor for older plays.',
    inputSchema: z.object({
      period: z.enum(['month', 'year', 'all']).default('month').describe('the last 30 days, the last 12 months, or everything'),
      limit: z.number().int().min(1).max(200).default(50), cursor: z.string().regex(/^\d+:\d+$/).optional(),
    }), annotations: READ,
  }, async ({ period, limit, cursor }) => {
    const [before, id] = cursor ? cursor.split(':').map(Number) : [Date.now() + 86400000, 0];
    const { plays, more } = await historyPage(uid, before, id, period, limit), last = plays.at(-1);
    return ok({ plays, next: more && last ? `${last.at}:${last.id}` : null });
  });

  s.registerTool('lists', {
    description: 'Your lists (id, name, kind manual or smart, count), lists you follow, and the built-in ones: plan (Plan to watch), watched and rated.',
    inputSchema: z.object({}), annotations: READ,
  }, async () => { const { genres: _, ...l } = await listsOf(uid); return ok(l); });

  s.registerTool('list', {
    description: "A list's titles by its id from lists: plan (Plan to watch, newest added first), watched (last watched first), rated (your highest first) or one of your lists.",
    inputSchema: z.object({ id: z.string().regex(/^[\w-]{4,20}$/), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) }),
    annotations: READ,
  }, async ({ id, offset, limit }) => {
    const l = isBuiltin(id) ? await builtinOf(uid, id) : await listOf(uid, id);
    if (!l) return fail('no such list');
    return ok({ ...l, total: l.items.length, offset, items: l.items.slice(offset, offset + limit) });
  });

  s.registerTool('up_next', {
    description: "What's next: the next episode of each show you're watching (se, ep), and this week's airing episodes of what you follow.",
    inputSchema: z.object({}), annotations: READ,
  }, async () => ok(await upNextOf(uid)));

  s.registerTool('stats', {
    description: 'Your watching stats: time watched, plays, top genres, and more.',
    inputSchema: z.object({ period: z.string().regex(/^(12m|all|\d{4})$/).default('12m').describe('12m (the last 12 months), all, or a year such as 2026') }),
    annotations: READ,
  }, async ({ period }) => ok(await statsOf(uid, period as Period)));

  s.registerTool('watchlist', {
    description: `Add a title to Plan to watch (on true) or take it off (on false).${ASKED}`,
    inputSchema: z.object({ key, on: z.boolean().default(true) }), annotations: WRITE(false),
  }, async ({ key: k, on }) => answer(await page(on ? 'PUT' : 'DELETE', `/watchlist/${encodeURIComponent(k)}`)));

  s.registerTool('list_item', {
    description: `Add a title to one of your manual lists (on true) or take it out (on false). The list's id is from lists.${ASKED}`,
    inputSchema: z.object({ list: z.string().regex(/^[\w-]{6,20}$/), key, on: z.boolean().default(true) }), annotations: WRITE(false),
  }, async ({ list, key: k, on }) => { const r = await setItem(uid, list, await canonKey(k), on); return r.error ? fail(r.error) : ok(r); });

  s.registerTool('list_create', {
    description: `Make a new manual list, optionally with a first title. Answers its id.${ASKED}`,
    inputSchema: z.object({ name: z.string().min(1).max(60), description: z.string().max(200).optional(), add: key.optional() }), annotations: { ...WRITE(false), idempotentHint: false },
  }, async (b) => { const r = await createList(uid, b); return 'error' in r ? fail(r.error) : ok(r); });

  s.registerTool('mark', {
    description: `Mark a movie, or episodes of a season, as watched (a play each), or with watched false take the latest play off. A movie needs no season.${ASKED}`,
    inputSchema: z.object({
      key, season: z.number().int().min(0).optional(), episodes: z.array(z.number().int().min(0)).min(1).max(500).optional().describe('with season; leave out for a movie'),
      watched: z.boolean().default(true),
      date: z.union([z.literal('unknown'), z.iso.date()]).optional().describe('YYYY-MM-DD, or unknown when the user does not know; leave out for now'),
    }), annotations: { ...WRITE(true), idempotentHint: false },
  }, async ({ key: k, season, episodes, watched, date }) => {
    if ((season == null) !== (episodes == null)) return fail('season and episodes go together (neither for a movie)');
    const at = date === 'unknown' ? 'unknown' : date ? Math.min(Date.parse(`${date}T19:00:00Z`), Date.now()) : undefined;
    return answer(await page('POST', `/mark/${encodeURIComponent(k)}`, { season: season ?? -1, episodes: episodes ?? [-1], watched, ...(at === undefined ? {} : { at }) }));
  });

  s.registerTool('rate', {
    description: `Rate a title, a season or an episode 1-10 (0.1 steps), or take the rating off with null. Rating a movie you have no play of marks it watched on an unknown date.${ASKED}`,
    inputSchema: z.object({ key, rating: z.number().min(1).max(10).nullable(), season: z.number().int().min(0).optional(), episode: z.number().int().min(0).optional() }),
    annotations: WRITE(true),
  }, async ({ key: k, rating, season, episode }) => {
    if (episode != null && season == null) return fail('an episode needs its season');
    return answer(await page('POST', `/rate/${encodeURIComponent(k)}`, { rating, season: season ?? -1, episode: episode ?? -1 }));
  });
  return s;
}

// the endpoint: api.ts checks the key, then hands the request here with its user in authInfo.extra
export const mcpHandler = (internal: Internal) => createMcpHandler(({ authInfo }) => server(String(authInfo?.extra?.uid), internal));
