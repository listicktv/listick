// The MCP server (/api/v1/mcp) end to end through an MCP client: its key, its tools, and that writes land where the page's do
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { pool } from '@/db';
import { handle } from '@/server/api';
import { q } from '@/server/db';
import { addPlay } from '@/server/plays';
import { addTitles, addUser, api, fixtures, ORIGIN, resetDb, signIn, title } from './helpers';

const MATRIX = 'tmdb:movie:603', SHOW = 'tmdb:tv:1399';
let key = '', uid = '';

before(async () => {
  await resetDb();
  fixtures({ '/3/search/multi': { results: [{ id: 603, media_type: 'movie', title: 'The Matrix', release_date: '1999-03-31', vote_average: 8.2, poster_path: '/m.jpg' }] } });
  uid = await addUser('alice');
  await addTitles(title(MATRIX, { title: 'The Matrix' }), title(SHOW, { title: 'Game of Thrones', episodes: 73 }));
  const me = await signIn('alice');
  key = (await me.post('/api/account/apikey/mcp')).json.apiKeys.find((k: { id: string }) => k.id === 'mcp').key;
});
after(() => pool.end());

async function connect(k = key) {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/v1/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${k}` } }, fetch: (url, init) => handle(new Request(url, init)),
  }));
  return client;
}
// a tool's answer: its JSON, or its error text
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args }) as { content: { type: string; text: string }[]; isError?: boolean };
  const text = r.content[0]?.text ?? '';
  return r.isError ? { error: text } : { data: JSON.parse(text) };
}

describe('MCP server', () => {
  test('opens only with an MCP key', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    const post = (headers: Record<string, string>) => api('/api/v1/mcp', { method: 'POST', body: init, headers: { accept: 'application/json, text/event-stream', ...headers } });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ authorization: 'Bearer not-a-real-key-at-all' })).status, 401);
    const me = await signIn('alice');
    const cal = (await me.post('/api/account/apikey/calendar')).json.apiKeys.find((k: { id: string }) => k.id === 'calendar').key;
    assert.equal((await post({ authorization: `Bearer ${cal}` })).status, 403, 'a calendar key has no mcp scope');
    assert.equal((await post({ authorization: `Bearer ${key}` })).status, 200);
  });

  test('lists its tools, reads marked read-only and writes not', async () => {
    const client = await connect();
    const tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
    assert.deepEqual([...tools.keys()].sort(), ['history', 'list', 'list_create', 'list_item', 'lists', 'mark', 'rate', 'search', 'stats', 'title', 'up_next', 'watchlist']);
    for (const n of ['search', 'title', 'history', 'lists', 'list', 'up_next', 'stats']) assert.equal(tools.get(n)!.annotations?.readOnlyHint, true, n);
    for (const n of ['watchlist', 'list_item', 'list_create', 'mark', 'rate']) assert.equal(tools.get(n)!.annotations?.readOnlyHint, false, n);
    await client.close();
  });

  test('search answers keys without images', async () => {
    const client = await connect();
    const r = await call(client, 'search', { query: 'matrix' });
    const hit = r.data.results.find((t: { key: string }) => t.key === MATRIX);
    assert.equal(hit.title, 'The Matrix');
    assert.equal(hit.poster, undefined, 'no image urls for the model');
    await client.close();
  });

  test('the watchlist, marks, ratings and history change as on the page', async () => {
    const client = await connect();
    assert.ok(!(await call(client, 'watchlist', { key: MATRIX })).error);
    assert.deepEqual((await call(client, 'list', { id: 'plan' })).data.items.map((t: { key: string }) => t.key), [MATRIX]);
    assert.ok(!(await call(client, 'watchlist', { key: MATRIX, on: false })).error);
    assert.equal((await call(client, 'list', { id: 'plan' })).data.total, 0);

    assert.ok(!(await call(client, 'mark', { key: SHOW, season: 1, episodes: [1, 2], date: '2026-01-02' })).error);
    const h = (await call(client, 'history', { period: 'all' })).data;
    assert.deepEqual(h.plays.map((p: { season: number; episode: number }) => [p.season, p.episode]), [[1, 2], [1, 1]]);
    assert.match(h.plays[0].at, /^2026-01-02T/, 'times as ISO 8601');
    assert.equal((await call(client, 'mark', { key: SHOW, season: 1 })).error, 'season and episodes go together (neither for a movie)');

    assert.ok(!(await call(client, 'rate', { key: MATRIX, rating: 8.5 })).error);
    assert.equal((await q.one<{ rating: number }>('select rating from ratings where user_id = ? and key = ?', uid, MATRIX))!.rating, 8.5);
    assert.equal((await q.one<{ n: number }>('select count(*)::int n from history where user_id = ? and key = ?', uid, MATRIX))!.n, 1, 'rated unwatched: a play');
    assert.ok((await call(client, 'rate', { key: MATRIX, rating: 11 })).error, 'out of range');
    assert.ok((await call(client, 'title', { key: 'imdb:tt0133093' })).error, 'a bad key');
    assert.ok(Array.isArray((await call(client, 'up_next')).data.upNext));
    assert.ok((await call(client, 'stats', { period: 'all' })).data);
    await client.close();
  });

  test('manual lists: made, filled and emptied; a missing one is an error', async () => {
    const client = await connect();
    const { id } = (await call(client, 'list_create', { name: 'Weekend', add: MATRIX })).data;
    assert.deepEqual((await call(client, 'list', { id })).data.items.map((t: { key: string }) => t.key), [MATRIX]);
    assert.ok(!(await call(client, 'list_item', { list: id, key: SHOW })).error);
    assert.ok(!(await call(client, 'list_item', { list: id, key: MATRIX, on: false })).error);
    assert.deepEqual((await call(client, 'list', { id })).data.items.map((t: { key: string }) => t.key), [SHOW]);
    assert.ok((await call(client, 'lists')).data.lists.some((l: { id: string }) => l.id === id));
    assert.equal((await call(client, 'list', { id: 'nope-nope' })).error, 'no such list');
    await client.close();
  });

  test("another user's key sees only their own", async () => {
    await addUser('bob');
    const bob = await signIn('bob', 'password-123', '198.51.100.2');
    const k = (await bob.post('/api/account/apikey/mcp')).json.apiKeys.find((x: { id: string }) => x.id === 'mcp').key;
    await addPlay(uid, MATRIX, -1, -1, Date.now(), 'manual');
    const client = await connect(k);
    assert.deepEqual((await call(client, 'history', { period: 'all' })).data.plays, []);
    await client.close();
  });
});
