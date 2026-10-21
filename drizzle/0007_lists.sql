CREATE TABLE "list_items" (
	"list_id" text NOT NULL,
	"key" text NOT NULL,
	"added_at" bigint NOT NULL,
	CONSTRAINT "list_items_list_id_key_pk" PRIMARY KEY("list_id","key")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"media" text,
	"filters" jsonb,
	"items" jsonb,
	"stremio" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"refreshed_at" bigint
);
--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_key_titles_key_fk" FOREIGN KEY ("key") REFERENCES "public"."titles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lists_user" ON "lists" USING btree ("user_id");