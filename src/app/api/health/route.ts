import { sql } from "drizzle-orm";
import { db } from "@/db";
import { jobRuns } from "@/db/schema";

// for container health checks and uptime monitors: the database answers, and when the worker last ran. With ?worker it also
// fails once the worker's heartbeat is 3 minutes old (for an uptime monitor); the container's own check leaves that out, so a
// stopped worker never takes the web app out of the proxy
export async function GET(req: Request) {
  try {
    await db.execute(sql`select 1`);
    const jobs = await db.select().from(jobRuns);
    const beat = jobs.find((j) => j.job === "heartbeat")?.lastRunAt;
    const worker = beat && Date.now() - beat.getTime() < 3 * 60_000 ? "ok" : "stale";
    if (worker === "stale" && new URL(req.url).searchParams.has("worker")) return Response.json({ ok: false, worker }, { status: 503 });
    return Response.json({ ok: true, worker });
  } catch (err) {
    console.error("health:", err);
    return Response.json({ ok: false, error: "the database isn't answering" }, { status: 503 });
  }
}
