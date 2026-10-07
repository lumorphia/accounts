import { z } from "zod";
import { eq, schema, type Database } from "@lumorphia-accounts/db";
import { DomainError, importLegacyLedger, releaseLegacyAccount } from "@lumorphia-accounts/core";
import type { Auth } from "./auth/auth.ts";
export type LegacyAdminAction =
  { kind: "import"; snapshot: unknown; apply: boolean } | { kind: "release"; legacyUserId: string };
/** HTTP には公開せず、取り込みスクリプトから現在の運営者を確認する。 */
export async function manageLegacyLedger(
  deps: { db: Database; auth: Auth; headers: Headers },
  action: LegacyAdminAction,
) {
  const session = await deps.auth.api.getSession({ headers: deps.headers });
  const user = session
    ? await deps.db.query.users.findFirst({
        where: eq(schema.users.id, session.user.id),
        columns: { role: true, status: true },
      })
    : undefined;
  if (!user || user.role !== "admin" || user.status !== "active")
    throw new DomainError("forbidden", "active_administrator_required");
  if (action.kind === "import")
    return importLegacyLedger(deps.db, action.snapshot, new Date(), { dryRun: !action.apply });
  const id = z.string().uuid().safeParse(action.legacyUserId);
  if (!id.success) throw new DomainError("validation", "invalid_legacy_user_id");
  return releaseLegacyAccount(deps.db, id.data);
}
