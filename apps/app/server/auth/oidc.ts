import { oauthProvider } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { APIError } from "better-auth/api";
import { eq, schema, type Database } from "@lumorphia-accounts/db";

export const OIDC_CLAIM_NAMESPACE = "https://lumorphia.com/";
export const OIDC_SCOPES = ["openid", "profile", "email", "lumorphia:identities"];

/** claim は最新の利用者状態と連携から作る。台帳の legacy_pending は A1.5 で埋める。 */
export async function lumorphiaClaims(
  db: Database,
  userId: string,
  scopes: string[],
): Promise<Record<string, unknown>> {
  const user = await db.query.users.findFirst({
    columns: { handle: true, status: true },
    where: eq(schema.users.id, userId),
  });
  if (!user || user.status !== "active")
    throw APIError.from("FORBIDDEN", { code: "access_denied", message: "active account required" });
  const profile = scopes.includes("profile")
    ? {
        [`${OIDC_CLAIM_NAMESPACE}handle`]: user.handle,
        [`${OIDC_CLAIM_NAMESPACE}legacy_pending`]: [],
      }
    : {};
  if (!scopes.includes("lumorphia:identities")) return profile;
  const accounts = await db.query.accounts.findMany({
    columns: { providerId: true, accountId: true },
    where: eq(schema.accounts.userId, userId),
  });
  return {
    ...profile,
    [`${OIDC_CLAIM_NAMESPACE}identities`]: accounts
      .filter((account) => account.providerId !== "dev")
      .map((account) => ({ provider: account.providerId, id: account.accountId })),
  };
}

export function oidcPlugins(db: Database) {
  const provider = oauthProvider({
    loginPage: "/login",
    consentPage: "/consent",
    postLogin: {
      page: "/welcome",
      consentReferenceId: ({ user }) => user.id,
      shouldRedirect: async ({ user }) => {
        const current = await db.query.users.findFirst({
          columns: { status: true },
          where: eq(schema.users.id, user.id),
        });
        return current?.status === "pending";
      },
    },
    scopes: OIDC_SCOPES,
    grantTypes: ["authorization_code"],
    allowDynamicClientRegistration: false,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: ({ user }) => user?.role === "admin" && user?.status === "active",
    customIdTokenClaims: ({ user, scopes }) => lumorphiaClaims(db, user.id, scopes),
    customUserInfoClaims: ({ user, scopes }) => lumorphiaClaims(db, user.id, scopes),
  });
  type CompatibleProvider = Omit<typeof provider, "endpoints"> & {
    endpoints: {
      [K in keyof typeof provider.endpoints]: (typeof provider.endpoints)[K] &
        NonNullable<BetterAuthPlugin["endpoints"]>[string];
    };
  };
  return [
    jwt({
      jwks: {
        keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
        rotationInterval: 90 * 86_400,
        gracePeriod: 7 * 86_400,
      },
    }),
    // 1.7.7 の OpenAPI metadata の型は exactOptionalPropertyTypes と合わない。
    // 実行時の plugin を変えず、具体的な endpoint の型を残して境界だけ合わせる。
    provider as unknown as CompatibleProvider,
  ] as const;
}
