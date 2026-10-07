import { sql } from "drizzle-orm";
import {
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

export const serviceMemberships = pgTable(
  "service_memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("service_memberships_pair_idx").on(t.userId, t.service),
    check("service_memberships_revision_check", sql`${t.revision} >= 0`),
  ],
);

// 利用者やクライアントを物理削除しても配送を続けるため、FK を付けない。
export const accountEvents = pgTable(
  "account_events",
  {
    id: id(),
    sub: uuid("sub").notNull(),
    service: text("service").notNull(),
    clientId: text("client_id").notNull(),
    endpoint: text("endpoint").notNull(),
    revision: integer("revision").notNull(),
    state: text("state", { enum: ["active", "deleted", "purged"] }).notNull(),
    scope: text("scope", { enum: ["account", "service"] }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    recoverUntil: timestamp("recover_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("account_events_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.deliveredAt} is null`),
    uniqueIndex("account_events_stream_revision_idx").on(t.sub, t.clientId, t.revision),
  ],
);

export const assetDeletions = pgTable(
  "asset_deletions",
  {
    id: id(),
    sub: uuid("sub").notNull(),
    keyBase: text("key_base").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("asset_deletions_key_idx").on(t.keyBase),
    index("asset_deletions_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.deletedAt} is null`),
  ],
);
