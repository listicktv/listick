import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// counts and millisecond times come back as numbers (bigint and numeric are strings by default; ours stay far below 2^53)
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

// one pool per process; DATABASE_URL is the only thing that changes from one host to another.
// DATABASE_POOL_MAX caps its connections: a serverless host runs many copies of the web app, each with its own pool
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX) || 10 });
// a database restart ends idle connections; the pool drops them and reconnects on the next query
pool.on("error", (e) => console.error("db pool:", e.message));

export const db = drizzle(pool, { schema });
export { pool };
