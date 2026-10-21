import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ensureOwner } from "@/server/owner";
import { db, pool } from "./index";

// applies drizzle/*.sql in order, then makes the owner on a fresh instance; run once per deploy before the web app and worker start
await migrate(db, { migrationsFolder: "drizzle" });
console.log("migrations applied");
await ensureOwner();
await pool.end();
