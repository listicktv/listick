import { sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { jobRuns } from "@/db/schema";
import { collapseDoubles } from "@/server/plays";
import { refreshDue, reselect } from "@/server/lists";
import { refreshDiscs } from "@/server/bluray";
import { checkDue } from "@/server/scores";
import { fillAnimeGenres } from "@/server/animegenres";
import { fillRuntimes } from "@/server/stats";
import { ROWS, SERVICE_ROWS, fillGenres, refreshRows, refreshServicesRows, rowsNow, warmDetails } from "@/server/rows";
import { refreshOldTitles } from "@/server/titles";
import { flushCalls } from "@/server/sources";
import { activeUsers, allUsers } from "@/server/store";
import { pollRound } from "@/server/poller";
import { moveAnimeToTmdb, refreshLive, trackingSince } from "@/server/tracking";
import { alert } from "@/server/alert";
import { requeueStuck, runNextImport } from "@/server/import/run";
import { safe } from "@/server/util";

// its outside API calls count as the worker's, also when started without the image's LISTICK_ROLE (npm run worker)
process.env.LISTICK_ROLE ||= "worker";

// Background work runs here, not in the web app: hosts like Vercel only run code per request, so long-running loops
// (polling Stremio, nightly rows) need their own process. Each job: a name, an interval, a function;
// a run still going when the next is due is skipped.
type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

// the rows are built at start when the kept ones are older than the last 18:00, then daily at 18:00 (TZ)
// rows this run has built (or tried to): a new row is built once at start, not again while its source fails
const rowsTried = new Set<string>();
const last18 = () => {
  const d = new Date(); d.setHours(18, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d.getTime();
};
// LISTICK_DISABLE_JOBS: job names left off, comma-separated
const disabled = new Set((process.env.LISTICK_DISABLE_JOBS || "").split(",").map((x) => x.trim()).filter(Boolean));
const allJobs: Job[] = [
  { name: "heartbeat", everyMs: 60_000, run: async () => {} },
  // Stremio: tracking, Up next, For you
  { name: "live", everyMs: 15_000, run: async () => { await pollRound(await allUsers(), await activeUsers(), refreshLive); } },
  // blu-ray.com's new disc releases (its RSS feed, which updates every 30 min), for the smart lists that take them
  { name: "bluray", everyMs: 3 * 3600_000, run: async () => { const n = await refreshDiscs(); if (n) console.log(`bluray: ${n} new disc(s)`); } },
  { name: "rows", everyMs: 5 * 60_000, run: async () => {
    const r = await rowsNow();
    // daily after 18:00, and at once when a row was added since the last build (a new version): tried once per run, so a row
    // whose source keeps failing waits for the next day's build instead of being asked every 5 min
    const added = ROWS.some((x) => !Array.isArray(r.rows[x.id]) && !rowsTried.has(x.id));
    if (r.rows.at < last18() || added) { for (const x of ROWS) rowsTried.add(x.id); await refreshRows(); }
    // the services' rows likewise: daily, and at once when a new version added one
    else if (r.servicesAt < last18() || SERVICE_ROWS.some((x) => !Object.values(r.services).some((rows) => Array.isArray(rows[x.id])) && !rowsTried.has(`svc:${x.id}`))) {
      for (const x of SERVICE_ROWS) rowsTried.add(`svc:${x.id}`);
      await refreshServicesRows();
    }
  } },
  // every row's title cards ready before a first click; again before the 6 h cache runs out
  { name: "warm-details", everyMs: 5 * 3600_000, run: warmDetails },
  // TMDB's 6-month caching limit: the oldest TMDB titles fetched again
  { name: "refresh-titles", everyMs: 24 * 3600_000, run: () => refreshOldTitles() },
  // anime stored under Kitsu keys move to their TMDB show once Fribb maps them
  { name: "anime-to-tmdb", everyMs: 24 * 3600_000, run: moveAnimeToTmdb },
  // smart lists due by their refresh (daily, weekly)
  { name: "lists", everyMs: 15 * 60_000, run: refreshDue },
  // smart lists picking by other sources' scores: their candidates checked a few at a time
  { name: "scores", everyMs: 10 * 60_000, run: () => checkDue(reselect) },
  // anime's own genres (MyAnimeList's, else Kitsu's) in place of TMDB's loose ones, 150 titles a run
  { name: "anime-genres", everyMs: 3600_000, run: () => fillAnimeGenres() },
  // Stats' hours: the runtime of each title you've watched, asked once
  { name: "runtimes", everyMs: 3600_000, run: () => fillRuntimes() },
  // history brought in from other services, one import at a time until none is waiting
  { name: "imports", everyMs: 10_000, run: async () => { while (await runNextImport()); } },
];
const jobs = allJobs.filter((j) => !disabled.has(j.name));

async function runJob(job: Job, busy: Set<string>) {
  if (busy.has(job.name)) return;
  busy.add(job.name);
  let error: string | null = null;
  try {
    await job.run();
  } catch (err) {
    error = String(err);
    console.error(`[${job.name}]`, err);
    await alert(`job failed: ${job.name}`, error);
  } finally {
    busy.delete(job.name);
  }
  await db
    .insert(jobRuns)
    .values({ job: job.name, lastRunAt: new Date(), lastError: error })
    .onConflictDoUpdate({ target: jobRuns.job, set: { lastRunAt: sql`excluded.last_run_at`, lastError: sql`excluded.last_error` } })
    .catch((err) => console.error("job_runs:", err));
}

// once at start: each user's tracking baseline, double plays collapsed, missing genres filled in the background
for (const u of await allUsers()) await trackingSince(u.id);
await requeueStuck();   // an import cut short by a restart runs again
const doubles = await collapseDoubles();
if (doubles) console.log(`history: ${doubles} double plays collapsed`);
void safe(fillGenres);

const busy = new Set<string>();
const timers = jobs.map((job) => {
  void runJob(job, busy);
  return setInterval(() => void runJob(job, busy), job.everyMs);
});
// the outside API calls made since the last write, added to api_calls
const flush = () => flushCalls().catch((err) => console.error("api-calls:", err));
timers.push(setInterval(flush, 30_000));
console.log(`worker: ${jobs.map((j) => j.name).join(", ")}`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    timers.forEach(clearInterval);
    await flush();
    await pool.end();
    process.exit(0);
  });
}
