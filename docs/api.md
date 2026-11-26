# Listick API (v1)

An API for addons and other apps: a user's lists and their titles, the calendar feed, plays sent by Jellyfin, Plex, Emby and Seanime, and an MCP server for AI assistants. Every route is under `/api/v1/` on a Listick instance (for example `https://listick.example.com/api/v1/me`, or `http://localhost:3000/api/v1/me`).

## Keys and scopes

Users create keys in **Settings › API access**, one per app. Creating a new key replaces the old one, which stops working.
Each key can use only the scopes its app needs: `lists` (the user's lists and their titles), `calendar` (the calendar
feed), `plays` (plays sent by Jellyfin, Plex, Emby or Seanime) or `mcp` (the MCP server). To add an app, add an entry to `APPS` in `src/server/api.ts`. Send the key as a header:

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
| `position`, `runtime` | `PlaybackPositionTicks`, `RunTimeTicks` | how far it is; 2 minutes to 90 % in goes to Continue watching |

The reply is `{ "ok": true, "recorded": <plays added> }`, or `{ "ok": true, "playing": true }` for a start or progress event.

### `POST /api/v1/plex/<key>` (`plays`)

What Plex's webhooks send (they need Plex Pass), set up from **Settings › Connections › Plex**. The key is in the
address; a wrong key gets `404`. The body is Plex's multipart form; its `payload` field is read as the Jellyfin events
above: `media.play` and `media.resume` are what's playing now, `media.pause` and `media.stop` keep the place for Continue
watching, `media.scrobble` (90 % in) is a play. Events with `user` false (another user on the server) are skipped. The movie
or episode is found by the `tmdb://`, `imdb://` and `tvdb://` ids in `Metadata.Guid`, else by `grandparentTitle`,
`parentIndex` and `index`.

The reply is the same as Jellyfin's.

### `POST /api/v1/emby/<key>` (`plays`)

What Emby's Webhooks send (they need Emby Premiere), set up from **Settings › Connections › Emby** with the user filter
set to your user. The key is in the address; a wrong key gets `404`. The body is JSON (a multipart form before Emby 4.9),
read as the Jellyfin events above: `playback.start` and `playback.unpause` are what's playing now, `playback.pause` keeps
the place for Continue watching, `playback.stop` with `PlaybackInfo.PlayedToCompletion`, `playback.scrobble` and
`item.markplayed` are a play. The movie or episode is found by `Item.ProviderIds` (`Tmdb`, `Imdb`, `Tvdb`), else by
`SeriesName`, `ParentIndexNumber` and `IndexNumber` (`IndexNumberEnd` for a double episode). The reply is the same as Jellyfin's.

### `GET /api/v1/anime` (`lists`)

The user's anime as AniList entries: `upNext` (next aired episode, `episode` numbered within the entry), `plan` (Plan to
watch), `lists` (own lists, followed lists with `owner`, then Watched and Rated) and `discover` (For you and the anime
rows); each list `{ id, name, items }` with up to 50 anime. Item:
`{ "anilistId": 154587, "key": "tmdb:tv:209867", "title": "Frieren", "year": 2023, "poster": "https://…", "episode": 29 }`.
Titles without an AniList mapping are left out.

### `POST /api/v1/anime/play` (`plays`)

An episode by AniList id: `{ "anilistId": 154587, "episode": 29, "state": "watched" }`. `state`: `playing` (watching now,
optional `progress` 0-100), `stopped` or `watched` (a play). A `progress` of 5 to 90 %, sent while playing or last before
`stopped`, goes to Continue watching. Answers `{ "ok": true, "recorded": 1 }`; unknown id: `404`.

### `/api/v1/mcp` (`mcp`)

An [MCP](https://modelcontextprotocol.io) server (Streamable HTTP, stateless) for AI assistants such as Claude, ChatGPT,
Copilot or Hermes, opened by an **AI assistant (MCP)** key sent as `Authorization: Bearer <key>`. Point the assistant at
`https://listick.example.com/api/v1/mcp`. Tools read and change the key's user only, through the same checks as the page:

| Tool | Does |
|---|---|
| `search` | find movies, shows and anime by name; each result's `key` is what the other tools take |
| `title` | a title's details, or with `season` that season's episodes |
| `history` | plays, newest first (`period` `month`, `year` or `all`; `cursor` for older ones) |
| `lists`, `list` | the user's lists, and one list's titles (`plan`, `watched`, `rated` or a list's id) |
| `up_next`, `stats` | the next episode of each show being watched and this week's airings; watching stats (`12m`, `all` or a year) |
| `watchlist`, `list_item`, `list_create` | add to or take off Plan to watch or a manual list; make a manual list |
| `mark`, `rate` | mark a movie or episodes watched (or take the latest play off); rate a title, season or episode, or unrate |

Read tools are annotated read-only; the rest ask the assistant to act only when the user asks. Answers are the page's JSON
without images, times as ISO 8601.
