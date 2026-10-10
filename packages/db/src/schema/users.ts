import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common.ts";

// 列名は Better Auth の Drizzle adapter (usePlural) に合わせる。
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    avatarKeyBase: text("avatar_key_base"),
    handle: text("handle").notNull(),
    role: text("role", { enum: ["user", "admin"] })
      .notNull()
      .default("user"),
    status: text("status", { enum: ["pending", "active", "suspended", "deleted"] })
      .notNull()
      .default("pending"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    handleChangedAt: timestamp("handle_changed_at", { withTimezone: true }),
    termsVersion: text("terms_version"),
    privacyVersion: text("privacy_version"),
    legalAcceptedAt: timestamp("legal_accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_handle_idx").on(t.handle), uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    displayName: text("display_name"),
    imageUrl: text("image_url"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("accounts_provider_account_idx").on(t.providerId, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Mastodon はサーバーごとに OAuth クライアントを登録する。secret はログに出さない。 */
export const mastodonApps = pgTable("mastodon_apps", {
  host: text("host").primaryKey(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 利用者の情報を持たない、worker の死活確認だけの記録。 */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  name: text("name").primaryKey(),
  enabled: boolean("enabled").notNull(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
});
