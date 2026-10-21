CREATE TABLE "list_follows" (
	"user_id" text NOT NULL,
	"list_id" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "list_follows_user_id_list_id_pk" PRIMARY KEY("user_id","list_id")
);
--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "list_follows" ADD CONSTRAINT "list_follows_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_follows" ADD CONSTRAINT "list_follows_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;