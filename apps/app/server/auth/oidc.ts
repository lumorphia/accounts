import { getOAuthProviderApi, oauthProvider } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { jwt, signJWT } from "better-auth/plugins/jwt";
import { z } from "zod";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { legacyPendingServices, visitService } from "@lumorphia-accounts/core";
import { eq, schema, type Database } from "@lumorphia-accounts/db";

export const OIDC_CLAIM_NAMESPACE = "https://lumorphia.com/";
export const OIDC_SCOPES = [
  "openid",
  "profile",
  "email",
  "lumorphia:identities",
  "lumorphia:characters",
  "lumorphia:legacy",
];

/** claim は最新の利用者状態、連携、引き継ぎ待ちの台帳から作る。 */
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
        [`${OIDC_CLAIM_NAMESPACE}legacy_pending`]: await legacyPendingServices(db, userId),
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
    customIdTokenClaims: async ({ user, scopes, metadata }) => {
      const claims = await lumorphiaClaims(db, user.id, scopes);
      if (typeof metadata?.lumorphia_service === "string")
        await visitService({ db }, user.id, metadata.lumorphia_service);
      return claims;
    },
    customUserInfoClaims: ({ user, scopes }) => lumorphiaClaims(db, user.id, scopes),
  });
  type CompatibleProvider = Omit<typeof provider, "endpoints"> & {
    endpoints: {
      [K in keyof typeof provider.endpoints]: (typeof provider.endpoints)[K] &
        NonNullable<BetterAuthPlugin["endpoints"]>[string];
    };
  };
  const keys = jwt({
    jwks: {
      keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
      rotationInterval: 90 * 86_400,
      gracePeriod: 7 * 86_400,
    },
  });
  const access = {
    id: "character-access",
    endpoints: {
      signAccountEvent: createAuthEndpoint.serverOnly(
        {
          method: "POST",
          body: z.object({
            aud: z.string().min(1),
            sub: z.string().uuid(),
            jti: z.string().uuid(),
            lifecycle: z.object({
              service: z.string(),
              revision: z.number().int().positive(),
              state: z.enum(["active", "deleted", "purged"]),
              scope: z.enum(["account", "service"]),
              occurredAt: z.string(),
              deletedAt: z.string().nullable(),
              recoverUntil: z.string().nullable(),
            }),
          }),
        },
        async (ctx) => {
          const iat = Math.floor(Date.now() / 1000);
          return {
            token: await signJWT(ctx, {
              options: keys.options,
              header: { typ: "lumorphia-account-event+jwt" },
              payload: { ...ctx.body, iss: ctx.context.baseURL, iat, exp: iat + 120 },
            }),
          };
        },
      ),
      // パスを持たないサーバー内専用の呼び出し。HTTP の auth catch-all には公開しない。
      legacyAccess: createAuthEndpoint.serverOnly(
        { method: "POST", body: z.object({ token: z.string().min(1).max(8192) }) },
        async (ctx) =>
          getOAuthProviderApi(ctx, provider.options).requireActiveAccessToken(ctx.body.token),
      ),
      characterAccess: createAuthEndpoint(
        {
          method: "POST",
          body: z.object({ token: z.string().min(1).max(8192) }),
        },
        async (ctx) =>
          getOAuthProviderApi(ctx, provider.options).requireActiveAccessToken(ctx.body.token),
      ),
    },
  } satisfies BetterAuthPlugin;
  return [
    access,
    keys,
    // 1.7.7 の OpenAPI metadata の型は exactOptionalPropertyTypes と合わない。
    // 実行時の plugin を変えず、具体的な endpoint の型を残して境界だけ合わせる。
    provider as unknown as CompatibleProvider,
  ] as const;
}
