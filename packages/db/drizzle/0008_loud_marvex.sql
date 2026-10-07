DROP INDEX "legacy_accounts_migrated_to_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_accounts_migrated_to_idx" ON "legacy_accounts" USING btree ("service","migrated_to");