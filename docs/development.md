# Developing Listick

## Stack

| Part | Choice |
|---|---|
| App | Next.js (App Router, TypeScript), `output: "standalone"` |
| Database | Postgres via `DATABASE_URL` only |
| Queries and migrations | Drizzle (`src/db/schema.ts`, SQL in `drizzle/`); plain SQL helpers in `src/server/db.ts` |
| Sign-in | Better Auth, users in our own Postgres (`src/db/auth-schema.ts`) |
| Background jobs | `src/worker/`, a separate process, never inside the web app |

Nothing is tied to one host: to move, change `DATABASE_URL` and `APP_ORIGIN`. Everything the web app and the
worker share (rows, live Stremio data, title cards, sign-in limits, outside API counts) is in Postgres, so they can run on
different hosts.

## Layout

- `src/ui/`: the page as React (`App.tsx` and its screens; `lib/` for data, formats, icons, colours and the look). Every page
  route renders the same layout, which picks the screen by the address. Stylesheet: `src/app/style.css` (tokens, fonts by role
  and the type scale at the top).
- `src/server/`: the app's logic.
  - `api.ts`: every `/api/*` route (the page's and the public API `/api/v1/*`: [`api.md`](api.md))
  - `page.ts` (the page's summary, shelves, rows, search), `details.ts` (a title's card), `cards.ts`, `plays.ts`
  - `lists.ts` (lists and the smart list builder), `athome.ts` and `bluray.ts` (Latest releases), `scores.ts` (other
    sources' scores for smart lists)
  - `rows.ts` (shared and streaming rows), `foryou.ts`, `upnext.ts` (Up next and the calendar), `stats.ts`, `region.ts`
  - `tracking.ts` and `live.ts` (Stremio turned into plays), `mapping.ts` (Fribb's anime mapping), `titles.ts`, `names.ts`
  - `catalogs.ts` (the public API's lists), `listsync.ts` (Sync to AniList and MyAnimeList)
  - `import/`: history from export files (Trakt, Simkl, Letterboxd, MyAnimeList, AniList) or Kitsu by username, queued in
    `imports` and run by the worker
  - `sources.ts` (every outside call, counted), `store.ts` (users and per-user state), `types.ts`
- `src/lib/`: shared by the page and the server (`auth.ts`, `cards.ts`).
- `src/worker/index.ts`: the background jobs, each recorded in `job_runs`: `live` (15 s, `poller.ts`), `rows` (daily 18:00),
  `lists`, `scores`, `bluray`, `imports`, and the upkeep jobs `warm-details`, `refresh-titles`, `anime-to-tmdb`,
  `anime-genres`, `runtimes`. `LISTICK_DISABLE_JOBS` turns jobs off.
- `scripts/start.mjs`: the image's entry (migrations, then web and worker).

## Running it

You need Node.js 24 and Postgres (CI uses 18). Put `TMDB_ACCESS_TOKEN` and `DATABASE_URL` in `.env` (see
`.env.example`). The web app reads `.env` itself; the migrations and the worker don't, so load it into your shell first:

```bash
npm ci
set -a; . ./.env; set +a
npm run db:migrate   # the schema, and the owner if LISTICK_OWNER_* are set
npm run dev          # the web app on http://localhost:3000
npm run worker       # the background jobs, in a second terminal
```

`npm run typecheck` and `npm run lint` are what CI checks besides the tests and the build.

## Tests

`npm test` runs `src/test/*.test.ts` (Node's test runner) against a database whose name ends in `_test`, which it wipes and
migrates first; calls to outside APIs are answered from fixtures.

```bash
docker run -d --rm --name listick-testdb -e POSTGRES_PASSWORD=test -e POSTGRES_DB=listick_test -p 127.0.0.1:55432:5432 postgres:18-alpine
DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/listick_test npm test
```

CI (`.github/workflows/ci.yml`) runs types, lint, the tests and the build on every push and pull request.

## Releases

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat:` for something new, `fix:`
for a fix, `feat!:` (or a `BREAKING CHANGE:` footer) for a change that needs action from people running Listick; `docs:`, `chore:`,
`refactor:` and `test:` make no release. On main, release-please (`.github/workflows/release.yml`) keeps a release pull
request with the next version and `CHANGELOG.md`; merging it tags `vX.Y.Z`, publishes the release and builds the image for
amd64 and arm64, each on its own native runner. Before 1.0, a breaking change raises the minor version.

## Changing the schema

1. Edit `src/db/schema.ts` (auth tables: change `src/lib/auth.ts`, then `npm run auth:generate`).
2. `npm run db:generate -- --name <what>` writes the SQL into `drizzle/`; commit it.
3. `npm run db:migrate` applies it (the image runs it on every start).
