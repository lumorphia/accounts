import * as z from "zod";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { localRedirect } from "./local-redirect.ts";
import {
  assertPublicHost,
  MiAuthHostError,
  normalizeHost,
  type HostPolicy,
} from "./miauth-host.ts";

/**
 * MiAuth (Misskey) を Better Auth のプラグインとして実装する (ADR-0004, docs/design/07 §3)。
 * OAuth ではないため social provider では表現できない。
 *
 * POST /miauth/start   { host } -> { url }   Misskey の承認画面へのリダイレクト先
 * GET  /miauth/callback?session=...          Misskey からの戻り。検証してセッション発行
 */

export type MiAuthOptions = {
  appName: string;
  /** callback の完全 URL を作るための公開 URL */
  baseURL: string;
  policy: HostPolicy;
  /** 認証後のリダイレクト先。既定 "/" */
  redirectTo?: string;
  /** テスト用: Misskey への HTTP を差し替える */
  fetch?: typeof fetch;
  isProduction?: boolean;
};

const START_COOKIE = "lumorphia.miauth";
const SESSION_TTL_MS = 10 * 60 * 1000;

const metaSchema = z.object({
  version: z.string(),
  features: z.object({ miauth: z.boolean().optional() }).partial().optional(),
});
const checkSchema = z.object({
  ok: z.boolean(),
  token: z.string().optional(),
  user: z
    .object({
      id: z.string(),
      username: z.string(),
      name: z.string().nullable().optional(),
      avatarUrl: z.string().nullable().optional(),
    })
    .optional(),
});

export const MIAUTH_ERROR = {
  INVALID_HOST: "MiAuth の接続先が不正です",
  HOST_UNAVAILABLE: "Misskey サーバーに接続できません",
  SESSION_MISMATCH: "認証セッションが一致しません。最初からやり直してください",
  DENIED: "Misskey で承認されませんでした",
  SUSPENDED: "このアカウントは停止されています",
  ALREADY_LINKED: "この Misskey アカウントは別の Lumorphia アカウントに連携されています",
} as const;

export function miauth(options: MiAuthOptions) {
  const doFetch = options.fetch ?? fetch;
  const devHosts = options.isProduction ? [] : (options.policy.devHosts ?? []);

  const resolve = async (input: string): Promise<{ host: string; origin: string }> => {
    if (devHosts.includes(input)) return { host: input, origin: `http://${input}` };
    let host: string;
    try {
      host = normalizeHost(input);
      await assertPublicHost(host, options.policy);
    } catch (e) {
      if (e instanceof MiAuthHostError)
        throw APIError.from("BAD_REQUEST", { message: MIAUTH_ERROR.INVALID_HOST, code: e.reason });
      throw e;
    }
    return { host, origin: `https://${host}` };
  };

  return {
    id: "miauth",
    endpoints: {
      miauthStart: createAuthEndpoint(
        "/miauth/start",
        {
          method: "POST",
          body: z.object({ host: z.string().min(1).max(253), callbackURL: z.string().optional() }),
        },
        async (ctx) => {
          const { host, origin } = await resolve(ctx.body.host);

          // /api/meta で Misskey であることと MiAuth 対応を確認 (3 秒)
          let meta: z.infer<typeof metaSchema>;
          try {
            const res = await doFetch(`${origin}/api/meta`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ detail: false }),
              signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) throw new Error(String(res.status));
            meta = metaSchema.parse(await res.json());
          } catch {
            throw APIError.from("BAD_REQUEST", {
              message: MIAUTH_ERROR.HOST_UNAVAILABLE,
              code: "host_unavailable",
            });
          }
          if (meta.features?.miauth === false) {
            throw APIError.from("BAD_REQUEST", {
              message: MIAUTH_ERROR.INVALID_HOST,
              code: "miauth_disabled",
            });
          }

          const sessionId = crypto.randomUUID();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `miauth:${sessionId}`,
            value: JSON.stringify({
              host,
              origin,
              callbackURL: ctx.body.callbackURL ?? options.redirectTo ?? "/",
            }),
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          });
          ctx.setCookie(START_COOKIE, sessionId, {
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            path: "/",
            maxAge: SESSION_TTL_MS / 1000,
          });

          const callback = new URL(
            `${ctx.context.options.basePath ?? "/api/auth"}/miauth/callback`,
            options.baseURL,
          );
          const url = new URL(`/miauth/${sessionId}`, origin);
          url.searchParams.set("name", options.appName);
          url.searchParams.set("callback", callback.toString());
          url.searchParams.set("permission", "read:account");
          return ctx.json({ url: url.toString() });
        },
      ),

      miauthCallback: createAuthEndpoint(
        "/miauth/callback",
        { method: "GET", query: z.object({ session: z.string().uuid() }) },
        async (ctx) => {
          const sessionId = ctx.query.session;
          const cookie = ctx.getCookie(START_COOKIE);
          ctx.setCookie(START_COOKIE, "", { maxAge: 0, path: "/" });
          if (cookie !== sessionId) {
            throw APIError.from("BAD_REQUEST", {
              message: MIAUTH_ERROR.SESSION_MISMATCH,
              code: "session_mismatch",
            });
          }
          const record = await ctx.context.internalAdapter.consumeVerificationValue(
            `miauth:${sessionId}`,
          );
          if (!record) {
            throw APIError.from("BAD_REQUEST", {
              message: MIAUTH_ERROR.SESSION_MISMATCH,
              code: "session_expired",
            });
          }
          const { host, origin, callbackURL } = JSON.parse(record.value) as {
            host: string;
            origin: string;
            callbackURL: string;
          };

          let check: z.infer<typeof checkSchema>;
          try {
            const res = await doFetch(`${origin}/api/miauth/${sessionId}/check`, {
              method: "POST",
              signal: AbortSignal.timeout(5000),
            });
            check = checkSchema.parse(await res.json());
          } catch {
            throw APIError.from("BAD_REQUEST", {
              message: MIAUTH_ERROR.HOST_UNAVAILABLE,
              code: "host_unavailable",
            });
          }
          if (!check.ok || !check.user) {
            throw APIError.from("UNAUTHORIZED", { message: MIAUTH_ERROR.DENIED, code: "denied" });
          }

          const accountKey = { providerId: "misskey", accountId: `${host}:${check.user.id}` };
          const owner = await ctx.context.internalAdapter.findAccountOwnerByKey(accountKey);
          let user = owner?.kind === "owned" ? owner.user : null;
          // 表示名とアイコン URL は accounts に持ち、ログインのたびに追従させる (#14, #35)
          const accountProfile = {
            displayName: check.user.username,
            imageUrl: check.user.avatarUrl ?? null,
          };
          const refreshAccountProfile = async () => {
            const existing = await ctx.context.internalAdapter.findAccountByKey(accountKey);
            // additionalFields は updateAccount の型に現れないので Record として渡す
            if (existing)
              await ctx.context.internalAdapter.updateAccount(
                existing.id,
                accountProfile as Record<string, unknown>,
              );
          };

          // ログイン済みなら連携モード: 未所有の Misskey アカウントを現在の利用者に繋ぐ (ADR-0017)
          const current = await getSessionFromCtx(ctx).catch(() => null);
          if (current) {
            if (user && user.id !== current.user.id) {
              throw APIError.from("CONFLICT", {
                message: MIAUTH_ERROR.ALREADY_LINKED,
                code: "already_linked",
              });
            }
            if (!user)
              await ctx.context.internalAdapter.linkAccount({
                ...accountKey,
                userId: current.user.id,
                ...accountProfile,
              });
            else await refreshAccountProfile();
            throw ctx.redirect(localRedirect(callbackURL));
          }

          if (!user) {
            user = await ctx.context.internalAdapter.createUser(
              {
                name: check.user.name || check.user.username,
                email: `${check.user.id}@misskey-${host.replace(/[^a-z0-9]/g, "-")}.placeholder.invalid`,
                emailVerified: false,
                image: check.user.avatarUrl ?? null,
              },
              { method: "miauth" },
            );
            // token は保存しない (docs/design/07 §3.2)
            await ctx.context.internalAdapter.linkAccount({
              ...accountKey,
              userId: user.id,
              ...accountProfile,
            });
          } else await refreshAccountProfile();
          if ((user as { status?: string }).status === "suspended") {
            throw APIError.from("FORBIDDEN", {
              message: MIAUTH_ERROR.SUSPENDED,
              code: "suspended",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          throw ctx.redirect(localRedirect(callbackURL));
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
