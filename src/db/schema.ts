import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, real, smallint, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

// times are epoch milliseconds, as the app and its page use them everywhere
const ms = (name: string) => bigint(name, { mode: "number" });
const userId = () => text("user_id").notNull().references(() => user.id, { onDelete: "cascade" });
// a whole title is season = episode = -1 (part of the primary keys, so not null)
const season = () => integer("season").notNull().default(-1);
const episode = () => integer("episode").notNull().default(-1);

// the worker's last run per job, so the web app (and a health check) can tell it is alive
export const jobRuns = pgTable("job_runs", {
  job: text("job").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
});

// Listick's own per-user settings beside Better Auth's user row (name = first name, username = sign-in name)
export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  isAdmin: boolean("is_admin").notNull().default(false),
  stremioKey: text("stremio_key"), // Stremio session key (from its login, or pasted)
  stremioUser: text("stremio_user"), // the Stremio account's email, to show which one
  trackingSince: ms("tracking_since"), // plays older than this are left to imports
  country: text("country"), // ISO 3166-1, the user's country (Settings › Region & services); smart lists start with it
  services: jsonb("services").$type<number[]>(), // TMDB watch provider ids the user pays for, in that country
  lang: text("lang"), // ISO 639-1: titles in this language where TMDB has them (title_names); none: as stored (English)
});

// TMDB / Kitsu metadata cache; key = 'tmdb:movie:603', 'tmdb:tv:1399', 'kitsu:anime:1'
export const titles = pgTable("titles", {
  key: text("key").primaryKey(),
  type: text("type", { enum: ["movie", "tv", "anime"] }).notNull(),
  title: text("title").notNull(),
  year: integer("year"),
  poster: text("poster"),
  backdrop: text("backdrop"),
  rating: real("rating"), // 0-10
  ratingSrc: text("rating_src"),
  overview: text("overview"),
  url: text("url"),
  label: text("label"),
  anime: smallint("anime"), // 1: Japanese animation
  episodes: integer("episodes"),
  imdb: text("imdb"), // its IMDb id, which Stremio opens titles by: asked of TMDB once, when a list first needs it; '' when TMDB has none
  runtime: integer("runtime"), // minutes: a film's, or a show's episode; 0 when TMDB / Kitsu have none (asked once; Stats' hours)
  genres: jsonb("genres").$type<string[]>(),
  animeGenres: jsonb("anime_genres").$type<string[]>(), // an anime's own (MyAnimeList's, else Kitsu's): Isekai, Slice of Life…; [] when neither has any
  fetchedAt: ms("fetched_at").notNull(), // TMDB content may be cached for 6 months at most
}, (t) => [check("titles_type", sql`${t.type} in ('movie', 'tv', 'anime')`)]);

export const history = pgTable("history", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  userId: userId(),
  key: text("key").notNull(),
  season: season(),
  episode: episode(),
  watchedAt: ms("watched_at").notNull(),
  approx: smallint("approx").notNull().default(0), // 1: date unknown (kept on the release day); 2: estimated (Stremio gap fill)
  source: text("source").notNull(),
}, (t) => [
  unique("history_play").on(t.userId, t.key, t.season, t.episode, t.watchedAt),
  index("history_time").on(t.userId, t.watchedAt.desc()),
  index("history_key").on(t.userId, t.key),
  index("history_title").on(t.key),
]);

export const playback = pgTable("playback", {
  userId: userId(),
  key: text("key").notNull(),
  season: season(),
  episode: episode(),
  progress: real("progress").notNull(),
  pausedAt: ms("paused_at").notNull(),
  source: text("source").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.key, t.season, t.episode] })]);

export const ratings = pgTable("ratings", {
  userId: userId(),
  key: text("key").notNull(),
  season: season(),
  episode: episode(),
  rating: real("rating").notNull(), // 1-10, decimals allowed (the rating dial)
  ratedAt: ms("rated_at").notNull(),
  source: text("source").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.key, t.season, t.episode] }), check("ratings_range", sql`${t.rating} between 1 and 10`)]);

export const watchlist = pgTable("watchlist", {
  userId: userId(),
  key: text("key").notNull().references(() => titles.key, { onDelete: "cascade" }),
  addedAt: ms("added_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })]);

// your lists: a manual one holds the titles you add (list_items); a smart one fills itself from its filters (TMDB's discover),
// its titles kept in items (keys, in order) and made again by the worker as often as its refresh says
export const lists = pgTable("lists", {
  id: text("id").primaryKey(),
  userId: userId(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind", { enum: ["manual", "smart"] }).notNull(),
  media: text("media", { enum: ["movie", "tv", "anime"] }), // a smart list's kind
  filters: jsonb("filters").$type<Record<string, unknown>>(),
  items: jsonb("items").$type<string[]>(), // a smart list's titles, in order
  shared: boolean("shared").notNull().default(false), // everyone on this Listick can open it, follow it or copy it
  position: integer("position").notNull().default(0),
  createdAt: ms("created_at").notNull(),
  refreshedAt: ms("refreshed_at"),
}, (t) => [index("lists_user").on(t.userId)]);

// someone else's shared list on your Lists page (read-only; theirs to change)
export const listFollows = pgTable("list_follows", {
  userId: userId(),
  listId: text("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  at: ms("at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.listId] })]);

export const listItems = pgTable("list_items", {
  listId: text("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  key: text("key").notNull().references(() => titles.key, { onDelete: "cascade" }),
  addedAt: ms("added_at").notNull(),
}, (t) => [primaryKey({ columns: [t.listId, t.key] })]);

// per-source bookkeeping (Stremio items, hidden cards, the onboarding choice, ...)
export const syncState = pgTable("sync_state", {
  userId: userId(),
  source: text("source").notNull(),
  item: text("item").notNull(),
  state: jsonb("state").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.source, t.item] })]);

// one key per user and app (APPS in src/server/api.ts); a key opens only its app's scopes
export const apiKeys = pgTable("api_keys", {
  userId: userId(),
  addon: text("addon").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ms("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.addon] })]);

export const invites = pgTable("invites", {
  token: text("token").primaryKey(), // sha256 of the link's token
  createdBy: text("created_by").references(() => user.id, { onDelete: "cascade" }),
  createdAt: ms("created_at").notNull(),
  expires: ms("expires").notNull(),
  usedBy: text("used_by"),
  usedAt: ms("used_at"),
});

// app-wide saved state (trending rows, landing posters, API call counts)
export const meta = pgTable("meta", {
  k: text("k").primaryKey(),
  v: jsonb("v"),
});

// a title's full card (TMDB / Kitsu / MAL details), shared by the web app and the worker that warms it; kept 6 h
export const detailCache = pgTable("detail_cache", {
  key: text("key").primaryKey(),
  at: ms("at").notNull(),
  value: jsonb("value").notNull(),
});

// what Stremio showed last per user, Up next, the calendar and For you: written by the worker every 15 s, read by the page
export const liveState = pgTable("live_state", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  at: ms("at").notNull(),
  value: jsonb("value").notNull(),
});

// sign-in attempts per address (also wrong addon keys), so the limit holds across every instance of the web app
export const signInAttempts = pgTable("sign_in_attempts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  ip: text("ip").notNull(),
  at: ms("at").notNull(),
}, (t) => [index("sign_in_attempts_ip").on(t.ip, t.at)]);

// outside API calls per day, process role (web, worker) and service; each process adds what it made since its last write
export const apiCalls = pgTable("api_calls", {
  day: text("day").notNull(), // YYYY-MM-DD in TZ
  role: text("role").notNull(),
  service: text("service").notNull(),
  calls: integer("calls").notNull().default(0),
  throttled: integer("throttled").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.role, t.service] })]);

// a user's history brought in from another service (Trakt, Simkl, Letterboxd, MyAnimeList), run by the worker.
// payload: what to import (a file's rows, or the service's token), cleared when the run ends; counts: what it added so far
export const imports = pgTable("imports", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  userId: userId(),
  source: text("source").notNull(),
  status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull().default("queued"),
  payload: jsonb("payload"),
  counts: jsonb("counts").notNull().default({}),
  error: text("error"),
  createdAt: ms("created_at").notNull(),
  startedAt: ms("started_at"),
  finishedAt: ms("finished_at"),
}, (t) => [index("imports_queue").on(t.status, t.createdAt), index("imports_user").on(t.userId, t.createdAt)]);

// OMDb scores per IMDb id (IMDb, Rotten Tomatoes, Metacritic)
// a title's name, poster (TMDB's path) and overview in another language, for users who want titles in it (names.ts)
export const titleNames = pgTable("title_names", {
  key: text("key").notNull(),
  lang: text("lang").notNull(),
  title: text("title"),
  poster: text("poster"),
  overview: text("overview"),
  fetchedAt: ms("fetched_at").notNull(),
}, (t) => [primaryKey({ columns: [t.key, t.lang] })]);

// other sources' scores per title for smart lists (scores.ts): imdb, rt, mc (through OMDb), mal, kitsu; score null = checked, none
export const titleScores = pgTable("title_scores", {
  key: text("key").notNull(),
  source: text("source").notNull(),
  score: real("score"),
  checkedAt: ms("checked_at").notNull(),
}, (t) => [primaryKey({ columns: [t.key, t.source] })]);

export const omdb = pgTable("omdb", {
  imdb: text("imdb").primaryKey(),
  data: jsonb("data").notNull(),
  fetchedAt: ms("fetched_at").notNull(),
});
