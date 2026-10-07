CREATE TABLE "lodestone_pacing" (
	"id" integer PRIMARY KEY NOT NULL,
	"finished_at" timestamp with time zone DEFAULT '1970-01-01'::timestamptz NOT NULL,
	CONSTRAINT "lodestone_pacing_singleton" CHECK ("lodestone_pacing"."id" = 1)
);
