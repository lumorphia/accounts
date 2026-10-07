import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common.ts";
import { users } from "./users.ts";

// 同じ取り込みの再実行で、移行済み・削除済みの台帳を再作成しない。
export const legacyImports = pgTable("legacy_imports", {
  service: text("service").primaryKey(),
  digest: text("digest").notNull(),
  importedCount: integer("imported_count").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
export const legacyAccounts = pgTable(
  "legacy_accounts",
  {
    id: id(),
    service: text("service").notNull(),
    legacyUserId: uuid("legacy_user_id").notNull(),
    handle: text("handle").notNull(),
    migratedAt: timestamp("migrated_at", { withTimezone: true }),
    migratedTo: uuid("migrated_to").references(() => users.id, { onDelete: "cascade" }),
    handleChoice: text("handle_choice", { enum: ["legacy", "current"] }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("legacy_accounts_service_user_idx").on(t.service, t.legacyUserId),
    uniqueIndex("legacy_accounts_handle_idx").on(t.handle),
    uniqueIndex("legacy_accounts_migrated_to_idx").on(t.service, t.migratedTo),
  ],
);
export const legacyIdentities = pgTable(
  "legacy_identities",
  {
    id: id(),
    legacyAccountId: uuid("legacy_account_id")
      .notNull()
      .references(() => legacyAccounts.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
  },
  (t) => [
    uniqueIndex("legacy_identities_provider_idx").on(t.service, t.providerId, t.accountId),
    index("legacy_identities_account_idx").on(t.legacyAccountId),
  ],
);
