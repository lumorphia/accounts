CREATE TABLE "legacy_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"service" text NOT NULL,
	"legacy_user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"migrated_at" timestamp with time zone,
	"migrated_to" uuid,
	"handle_choice" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"legacy_account_id" uuid NOT NULL,
	"service" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_imports" (
	"service" text PRIMARY KEY NOT NULL,
	"digest" text NOT NULL,
	"imported_count" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_accounts" ADD CONSTRAINT "legacy_accounts_migrated_to_users_id_fk" FOREIGN KEY ("migrated_to") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_identities" ADD CONSTRAINT "legacy_identities_legacy_account_id_legacy_accounts_id_fk" FOREIGN KEY ("legacy_account_id") REFERENCES "public"."legacy_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_accounts_service_user_idx" ON "legacy_accounts" USING btree ("service","legacy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_accounts_handle_idx" ON "legacy_accounts" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "legacy_accounts_migrated_to_idx" ON "legacy_accounts" USING btree ("migrated_to");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_identities_provider_idx" ON "legacy_identities" USING btree ("service","provider_id","account_id");--> statement-breakpoint
CREATE INDEX "legacy_identities_account_idx" ON "legacy_identities" USING btree ("legacy_account_id");