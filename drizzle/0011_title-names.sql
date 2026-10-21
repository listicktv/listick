CREATE TABLE "title_names" (
	"key" text NOT NULL,
	"lang" text NOT NULL,
	"title" text,
	"poster" text,
	"overview" text,
	"fetched_at" bigint NOT NULL,
	CONSTRAINT "title_names_key_lang_pk" PRIMARY KEY("key","lang")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "lang" text;