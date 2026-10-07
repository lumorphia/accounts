CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"lodestone_id" text NOT NULL,
	"name" text NOT NULL,
	"world" text NOT NULL,
	"data_center" text NOT NULL,
	"race" text,
	"clan" text,
	"gender" text,
	"avatar_url" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_token" text,
	"verification_expires_at" timestamp with time zone,
	"verification_error" text,
	"verification_checked_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_requested_at" timestamp with time zone,
	"sync_failures" integer DEFAULT 0 NOT NULL,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_lodestone_id_check" CHECK ("characters"."lodestone_id" ~ '^[1-9][0-9]{0,11}$'),
	CONSTRAINT "characters_sync_failures_check" CHECK ("characters"."sync_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_user_idx" ON "characters" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_user_lodestone_idx" ON "characters" USING btree ("user_id","lodestone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_primary_idx" ON "characters" USING btree ("user_id") WHERE "characters"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "characters_verified_lodestone_idx" ON "characters" USING btree ("lodestone_id") WHERE "characters"."verified_at" is not null;