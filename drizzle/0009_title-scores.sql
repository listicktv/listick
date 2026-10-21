CREATE TABLE "title_scores" (
	"key" text NOT NULL,
	"source" text NOT NULL,
	"score" real,
	"checked_at" bigint NOT NULL,
	CONSTRAINT "title_scores_key_source_pk" PRIMARY KEY("key","source")
);
