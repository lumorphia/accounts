import type { IncomingHttpHeaders } from "node:http";
import type { FastifyBaseLogger } from "fastify";
import { and, eq, inArray, isNull, lt, or, schema, type Database } from "@lumorphia-accounts/db";
import type { Auth } from "./auth.ts";
import { displayNameFromProfile } from "./account-display-name.ts";

/** これより古い、またはアイコン URL が無い連携だけ取り直す */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SOCIAL_PROVIDERS = ["discord", "google", "twitter"] as const;

/**
 * 連携済みの SNS アカウントの表示名とアイコン URL を、better-auth の accountInfo で取り直す。
 * トークンが切れていれば refresh token で更新される。失敗した行は触らない (前回値を残す)。
 * #35 より前に連携した行は image_url が空なので、/settings を開いたときにこれで埋める。
 */
export async function refreshLinkedAccountProfiles(input: {
  db: Database;
  auth: Auth;
  userId: string;
  headers: IncomingHttpHeaders;
  log: FastifyBaseLogger;
  now?: Date;
}): Promise<number> {
  const now = input.now ?? new Date();
  const stale = new Date(now.getTime() - STALE_AFTER_MS);
  const targets = await input.db
    .select({ id: schema.accounts.id, providerId: schema.accounts.providerId })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.userId, input.userId),
        inArray(schema.accounts.providerId, [...SOCIAL_PROVIDERS]),
        or(isNull(schema.accounts.imageUrl), lt(schema.accounts.updatedAt, stale)),
      ),
    );
  let refreshed = 0;
  for (const account of targets) {
    try {
      const info = await input.auth.api.accountInfo({
        query: { accountId: account.id },
        headers: new Headers(input.headers as Record<string, string>),
      });
      if (!info) continue;
      const displayName = displayNameFromProfile(account.providerId, info);
      const imageUrl = info.user.image ?? null;
      await input.db
        .update(schema.accounts)
        .set({
          ...(displayName ? { displayName } : {}),
          ...(imageUrl ? { imageUrl } : {}),
          updatedAt: now,
        })
        .where(eq(schema.accounts.id, account.id));
      refreshed += 1;
    } catch (err) {
      input.log.warn({ err, accountId: account.id }, "account profile refresh failed");
    }
  }
  return refreshed;
}
