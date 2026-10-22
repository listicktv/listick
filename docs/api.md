# Listick API (v1)

An API for addons and other apps: a user's lists and their titles, the calendar feed, and plays sent by Jellyfin and Seanime. Every route is under `/api/v1/` on a Listick instance (for example `https://listick.example.com/api/v1/me`, or `http://localhost:3000/api/v1/me`).

## Keys and scopes

Users create keys in **Settings › API access**, one per app. Creating a new key replaces the old one, which stops working.
Each key can use only the scopes its app needs: `lists` (the user's lists and their titles), `calendar` (the calendar
feed) or `plays` (plays sent by Jellyfin or Seanime). To add an app, add an entry to `APPS` in `src/server/api.ts`. Send the key as a header:

```
Authorization: Bearer <key>
```

A missing or wrong key gets `401` (`429` after too many wrong tries from one address); a route outside the key's scopes
gets `403`. Errors are JSON: `{ "error": "…" }`.

## Routes

### `GET /api/v1/me` (any key)

Who the key belongs to: `{ "name": "<username>", "app": "<app id>" }`.

### `GET /api/v1/lists` (`lists`)

Every list the user can read, listed once for each type it can contain:

```json
{ "lists": [{ "src": "plan", "type": "For You", "name": "Plan to watch", "group": "Your lists",
  "filter": { "name": "Type", "options": ["Movies", "Series", "Anime"] }, "genres": ["…"], "years": ["…"], "ratings": ["…"] }] }
```

- `src`: the list's id: `plan` (Plan to watch), `upnext`, `list.<id>` (the user's own lists), `foryou.suggested`,
  `foryou.coming`, `row.<row id>` (Listick's shared rows) and `svc.<row id>` (the streaming services' rows).
- `type`: `movie`, `series`, `anime` or `For You` (one mixed list).
- `filter`: the one filter the list takes, and its choices. `genres`, `years` and `ratings`: the extra choices a row offers.

### `GET /api/v1/lists/<src>` (`lists`)

A list's titles, newest first:

```json
{ "items": [{ "id": "tt0133093", "key": "tmdb:movie:603", "type": "movie", "title": "The Matrix", "year": 1999, "poster": "https://…", "next": "S2 E5" }] }
```

Query: `type` (as in `/lists`), `filter` (one of the list's filter choices), `genre` (inside a split list), `days` (how far
back Up next looks, 1–365, default 60). `id` is what Stremio and its addons know the title by: its IMDb id, else `kitsu:<id>` for an anime only Kitsu has, else
`tmdb:<id>`. `key` is Listick's own. `next` is only on lists that have one (Up next, Coming soon). An unknown `src`
gets `404`.

### `GET /api/v1/calendar/<key>.ics` (`calendar`)

The user's calendar (airing episodes and Plan to watch releases) as iCalendar. The key is in the address, since calendar
apps send no headers; a wrong key gets `404`.

### `POST /api/v1/jellyfin/<key>` (`plays`)

What Jellyfin's Webhook plugin sends, set up from **Settings › Connections › Jellyfin** (a Generic destination with
Listick's template). The key is in the address; a wrong key gets `404`. The body is the template's JSON:

| Field | From the plugin | Use |
|---|---|---|
| `event` | `NotificationType` | `PlaybackStart` and `PlaybackProgress`: what's playing now; `PlaybackStop` with `done`, or `UserDataSaved` with `played`: a play |
| `type` | `ItemType` | `Movie` or `Episode` |
| `tmdb`, `imdb`, `tvdb` | `Provider_tmdb`, `Provider_imdb`, `Provider_tvdb` | the movie, or the episode's own ids |
| `series`, `year`, `season`, `episode`, `episodeEnd` | `SeriesName`, `Year`, `SeasonNumber`, `EpisodeNumber`, `EpisodeNumberEnd` | an episode without ids |
| `name` | `Name` | the last play shown in Settings |
| `done`, `played` | `PlayedToCompletion`, `Played` | `True` or `False` |
| `position`, `runtime` | `PlaybackPositionTicks`, `RunTimeTicks` | how far it is |

The reply is `{ "ok": true, "recorded": <plays added> }`, or `{ "ok": true, "playing": true }` for a start or progress event.

### `GET /api/v1/anime` (`lists`)

The user's anime as AniList entries: `upNext` (next aired episode, `episode` numbered within the entry), `plan` (Plan to
watch), `lists` (own lists, followed lists with `owner`, then Watched and Rated) and `discover` (For you and the anime
rows); each list `{ id, name, items }` with up to 50 anime. Item:
`{ "anilistId": 154587, "key": "tmdb:tv:209867", "title": "Frieren", "year": 2023, "poster": "https://…", "episode": 29 }`.
Titles without an AniList mapping are left out.

### `POST /api/v1/anime/play` (`plays`)

An episode by AniList id: `{ "anilistId": 154587, "episode": 29, "state": "watched" }`. `state`: `playing` (watching now,
optional `progress` 0-100), `stopped` or `watched` (a play). Answers `{ "ok": true, "recorded": 1 }`; unknown id: `404`.
