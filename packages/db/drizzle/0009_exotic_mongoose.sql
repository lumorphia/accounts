CREATE TABLE "worker_heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legal_accepted_at" timestamp with time zone;