import { getOAuthProviderApi, oauthProvider } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { jwt, signJWT } from "better-auth/plugins/jwt";
import { z } from "zod";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  legacyPendingServices,
  pendingRecovery,
  serviceOfClientMetadata,
  visitService,
  type Service,
} from "@lumorphia-accounts/core";
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

async function serviceOfClient(db: Database, clientId: unknown): Promise<Service | null> {
  if (typeof clientId !== "string") return null;
  const client = await db.query.oauthClients.findFirst({
    columns: { metadata: true },
    where: eq(schema.oauthClients.clientId, clientId),
  });
  return serviceOfClientMetadata(client?.metadata);
}

/**
 * 認可の入口。トークンの発行より前に、状態を変える処理をここに集める (claim を作る処理では書かない)。
 *
 * - 退会中 (全体またはそのサービス) なら、ダッシュボードへ寄せて復旧を選ばせる (ADR-0011)。
 *   prompt=none は画面を出せないので寄せず、トークン発行の側で拒む
 * - そうでなければ、そのサービスを使い始めたことを記録する (visitService)。
 *   初回設定前 (pending) は /welcome から認可に戻ったときに記録する
 */
export function authorizeGate(db: Database) {
  return {
    id: "authorize-gate",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/authorize",
          handler: createAuthMiddleware(async (ctx) => {
            const query = (ctx.query ?? {}) as Record<string, unknown>;
            const promptNone =
              typeof query.prompt === "string" && query.prompt.split(" ").includes("none");
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const service = await serviceOfClient(db, query.client_id);
            const pending = await pendingRecovery({ db }, session.user.id, service);
            if (pending.account || pending.service) {
              if (promptNone) return;
              const requested = ctx.request ? new URL(ctx.request.url) : null;
              const next = requested
                ? `${requested.pathname}${requested.search}`
                : `/api/auth/oauth2/authorize?${new URLSearchParams(query as Record<string, string>)}`;
              const dashboard = new URLSearchParams({ next });
              if (!pending.account && pending.service && service) dashboard.set("service", service);
              throw ctx.redirect(`/?${dashboard}`);
            }
            if (service && session.user.status === "active")
              await visitService({ db }, session.user.id, service);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
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
    // 状態は変えない。認可の入口 (authorizeGate) で記録したあとに退会したサービスへは発行しない
    customIdTokenClaims: async ({ user, scopes, metadata }) => {
      const service = serviceOfClientMetadata(metadata);
      if (service && (await pendingRecovery({ db }, user.id, service)).service)
        throw APIError.from("FORBIDDEN", { code: "access_denied", message: "service_deleted" });
      return lumorphiaClaims(db, user.id, scopes);
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
  // サーバー内からだけ呼ぶ口。HTTP には出さない (serverOnly、かつ public-endpoints.ts の許可リストの外)
  const internal = {
    id: "lumorphia-internal",
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
      /** サービス間 API の Bearer を確かめる (server/auth/service-access.ts) */
      serviceAccess: createAuthEndpoint.serverOnly(
        { method: "POST", body: z.object({ token: z.string().min(1).max(8192) }) },
        async (ctx) =>
          getOAuthProviderApi(ctx, provider.options).requireActiveAccessToken(ctx.body.token),
      ),
    },
  } satisfies BetterAuthPlugin;
  return [
    authorizeGate(db),
    internal,
    keys,
    // 1.7.7 の OpenAPI metadata の型は exactOptionalPropertyTypes と合わない。
    // 実行時の plugin を変えず、具体的な endpoint の型を残して境界だけ合わせる。
    provider as unknown as CompatibleProvider,
  ] as const;
}
