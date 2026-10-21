// Plain SQL: statements with ? placeholders (numbered for Postgres here), each call async. jsonb values go in as JSON text
// and come back parsed; each query names the shape of its rows.
import type { PoolClient } from 'pg';
import { pool } from '@/db';

type Q = {
  one: <T>(sql: string, ...p: unknown[]) => Promise<T | undefined>;
  all: <T>(sql: string, ...p: unknown[]) => Promise<T[]>;
  run: (sql: string, ...p: unknown[]) => Promise<{ changes: number }>;
};

const numbered = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const on = (c: typeof pool | PoolClient): Q => ({
  one: async <T>(sql: string, ...p: unknown[]) => (await c.query(numbered(sql), p)).rows[0] as T | undefined,
  all: async <T>(sql: string, ...p: unknown[]) => (await c.query(numbered(sql), p)).rows as T[],
  run: async (sql: string, ...p: unknown[]) => ({ changes: (await c.query(numbered(sql), p)).rowCount ?? 0 }),
});
export const q = on(pool);
// several statements as one: q-like helpers on one connection, committed together
export async function tx<T>(fn: (t: Q) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(on(c));
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}
