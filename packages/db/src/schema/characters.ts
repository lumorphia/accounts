import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common.ts";
import { users } from "./users.ts";

export const characters = pgTable(
  "characters",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lodestoneId: text("lodestone_id").notNull(),
    name: text("name").notNull(),
    world: text("world").notNull(),
    dataCenter: text("data_center").notNull(),
    race: text("race"),
    clan: text("clan"),
    gender: text("gender"),
    avatarUrl: text("avatar_url"),
    isPrimary: boolean("is_primary").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationToken: text("verification_token"),
    verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
    verificationError: text("verification_error"),
    verificationCheckedAt: timestamp("verification_checked_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** ジョブの完了を待たずに、手動の要求自体を 1 日 1 回にする */
    syncRequestedAt: timestamp("sync_requested_at", { withTimezone: true }),
    syncFailures: integer("sync_failures").notNull().default(0),
    syncError: text("sync_error"),
    ...timestamps,
  },
  (t) => [
    index("characters_user_idx").on(t.userId),
    uniqueIndex("characters_user_lodestone_idx").on(t.userId, t.lodestoneId),
    uniqueIndex("characters_primary_idx")
      .on(t.userId)
      .where(sql`${t.isPrimary}`),
    uniqueIndex("characters_verified_lodestone_idx")
      .on(t.lodestoneId)
      .where(sql`${t.verifiedAt} is not null`),
    check("characters_lodestone_id_check", sql`${t.lodestoneId} ~ '^[1-9][0-9]{0,11}$'`),
    check("characters_sync_failures_check", sql`${t.syncFailures} >= 0`),
  ],
);
