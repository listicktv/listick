ALTER TABLE "profiles" DROP COLUMN "anilist_user";--> statement-breakpoint
-- AniList and the AniList / MAL progress copy are gone (2026-10-18): their bookkeeping, tokens and sign-ins in progress go too
DELETE FROM "sync_state" WHERE "source" IN ('anilist', 'anilist-wait', 'anilist-plan', 'stremio-end', 'oauth', 'oauth-pending', 'lists-last');
