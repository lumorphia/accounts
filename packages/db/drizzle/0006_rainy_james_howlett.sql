CREATE TABLE "account_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sub" uuid NOT NULL,
	"service" text NOT NULL,
	"client_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"revision" integer NOT NULL,
	"state" text NOT NULL,
	"scope" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"recover_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_deletions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sub" uuid NOT NULL,
	"key_base" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"service" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_memberships_revision_check" CHECK ("service_memberships"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_memberships" ADD CONSTRAINT "service_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_events_pending_idx" ON "account_events" USING btree ("next_attempt_at") WHERE "account_events"."delivered_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "account_events_stream_revision_idx" ON "account_events" USING btree ("sub","client_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_deletions_key_idx" ON "asset_deletions" USING btree ("key_base");--> statement-breakpoint
CREATE INDEX "asset_deletions_pending_idx" ON "asset_deletions" USING btree ("next_attempt_at") WHERE "asset_deletions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_memberships_pair_idx" ON "service_memberships" USING btree ("user_id","service");