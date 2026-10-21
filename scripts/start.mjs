// The image's entry: the migrations, then the web app (:3000) and the worker side by side; if either stops, the container stops
// (and its restart policy brings both back). One part alone: `start.mjs web`, `start.mjs worker` or `start.mjs migrate`, to
// run them as separate containers. Without BETTER_AUTH_SECRET, the secret is made on the first start and kept in the database.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import pg from 'pg';

const tsx = 'node_modules/.bin/tsx';
const parts = {
  migrate: [tsx, ['src/db/migrate.ts'], {}],
  web: ['node', ['server.js'], { cwd: 'web', role: 'web' }],
  worker: [tsx, ['src/worker/index.ts'], { role: 'worker' }],
};
const only = process.argv[2];
if (only && !parts[only]) { console.error(`start.mjs: ${only}? (web, worker or migrate)`); process.exit(2); }

async function authSecret() {
  if (process.env.BETTER_AUTH_SECRET) return;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("insert into meta (k, v) values ('auth-secret', to_jsonb($1::text)) on conflict (k) do nothing", [crypto.randomBytes(32).toString('base64')]);
    process.env.BETTER_AUTH_SECRET = (await db.query("select v #>> '{}' s from meta where k = 'auth-secret'")).rows[0].s;
  } finally { await db.end(); }
}

const children = new Set();
function run(name) {
  const [cmd, args, { cwd, role }] = parts[name];
  const env = { ...process.env, ...(role ? { LISTICK_ROLE: role } : {}) };
  if (name === 'migrate' && !env.BETTER_AUTH_SECRET) env.BETTER_AUTH_SECRET = crypto.randomBytes(32).toString('base64');
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env });
  children.add(child);
  return new Promise((done) => child.on('exit', (code, signal) => { children.delete(child); done(code ?? (signal ? 1 : 0)); }));
}
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; for (const c of children) c.kill(sig); });

if (only === 'migrate') process.exit(await run(only));
if (only) { await authSecret(); process.exit(await run(only)); }
const migrated = await run('migrate');
if (migrated || stopping) process.exit(migrated);
await authSecret();
const code = await Promise.race([run('web'), run('worker')]);
for (const c of children) c.kill('SIGTERM');
await Promise.all([...children].map((c) => new Promise((r) => c.on('exit', r))));
process.exit(stopping ? 0 : code || 1);
