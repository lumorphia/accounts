import * as z from "zod";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { localRedirect } from "./local-redirect.ts";
import { eq, schema, type Database } from "@lumorphia-accounts/db";
import {
  assertPublicHost,
  MiAuthHostError,
  normalizeHost,
  type HostPolicy,
} from "./miauth-host.ts";

/**
 * Mastodon のログイン (#55、docs/design/07 §3.3)。OAuth 2.0 だが、サーバーごとに
 * POST /api/v1/apps でクライアントを登録する必要があるので、better-auth の social provider では
 * 表現できず、MiAuth と同じくプラグインにする。
 *
 * POST /mastodon/start   { host } -> { url }        サーバーの /oauth/authorize へ
 * GET  /mastodon/callback?code&state                 code を token に替え、verify_credentials で本人を取る。
 *                                                    token は保存せず、取ったら revoke する
 */

export type MastodonOptions = {
  appName: string;
  baseURL: string;
  policy: HostPolicy;
  db: Database;
  redirectTo?: string;
  /** テスト用: Mastodon への HTTP を差し替える */
  fetch?: typeof fetch;
  isProduction?: boolean;
};

const START_COOKIE = "lumorphia.mastodon";
const SESSION_TTL_MS = 10 * 60 * 1000;
const SCOPE = "read:accounts";

const appSchema = z.object({ client_id: z.string(), client_secret: z.string() });
const tokenSchema = z.object({ access_token: z.string() });
const accountSchema = z.object({
  id: z.string(),
  username: z.string(),
  acct: z.string().optional(),
  display_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

export const MASTODON_ERROR = {
  INVALID_HOST: "Mastodon の接続先が不正です",
  HOST_UNAVAILABLE: "Mastodon サーバーに接続できません",
  SESSION_MISMATCH: "認証セッションが一致しません。最初からやり直してください",
  DENIED: "Mastodon で承認されませんでした",
  CANCELLED: "ログインがキャンセルされました",
  SUSPENDED: "このアカウントは停止されています",
  ALREADY_LINKED: "この Mastodon アカウントは別の Lumorphia アカウントに連携されています",
} as const;

export function mastodon(options: MastodonOptions) {
  const doFetch = options.fetch ?? fetch;
  const devHosts = options.isProduction ? [] : (options.policy.devHosts ?? []);
  const redirectUri = new URL(`/api/auth/mastodon/callback`, options.baseURL).toString();

  const resolve = async (input: string): Promise<{ host: string; origin: string }> => {
    if (devHosts.includes(input)) return { host: input, origin: `http://${input}` };
    let host: string;
    try {
      host = normalizeHost(input);
      await assertPublicHost(host, options.policy);
    } catch (e) {
      if (e instanceof MiAuthHostError)
        throw APIError.from("BAD_REQUEST", {
          message: MASTODON_ERROR.INVALID_HOST,
          code: e.reason,
        });
      throw e;
    }
    return { host, origin: `https://${host}` };
  };

  /** サーバーごとのクライアント。無ければ登録して mastodon_apps に残す */
  const clientFor = async (
    host: string,
    origin: string,
  ): Promise<{ clientId: string; clientSecret: string }> => {
    const existing = await options.db.query.mastodonApps.findFirst({
      where: eq(schema.mastodonApps.host, host),
    });
    if (existing) return { clientId: existing.clientId, clientSecret: existing.clientSecret };
    let registered: z.infer<typeof appSchema>;
    try {
      const res = await doFetch(`${origin}/api/v1/apps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: options.appName,
          redirect_uris: redirectUri,
          scopes: SCOPE,
          website: options.baseURL,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(String(res.status));
      registered = appSchema.parse(await res.json());
    } catch {
      throw APIError.from("BAD_REQUEST", {
        message: MASTODON_ERROR.HOST_UNAVAILABLE,
        code: "host_unavailable",
      });
    }
    await options.db
      .insert(schema.mastodonApps)
      .values({ host, clientId: registered.client_id, clientSecret: registered.client_secret })
      .onConflictDoUpdate({
        target: schema.mastodonApps.host,
        set: { clientId: registered.client_id, clientSecret: registered.client_secret },
      });
    return { clientId: registered.client_id, clientSecret: registered.client_secret };
  };

  return {
    id: "mastodon",
    endpoints: {
      mastodonStart: createAuthEndpoint(
        "/mastodon/start",
        {
          method: "POST",
          body: z.object({ host: z.string().min(1).max(253), callbackURL: z.string().optional() }),
        },
        async (ctx) => {
          const { host, origin } = await resolve(ctx.body.host);
          const client = await clientFor(host, origin);

          const state = crypto.randomUUID();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `mastodon:${state}`,
            value: JSON.stringify({
              host,
              origin,
              callbackURL: ctx.body.callbackURL ?? options.redirectTo ?? "/",
            }),
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          });
          ctx.setCookie(START_COOKIE, state, {
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            path: "/",
            maxAge: SESSION_TTL_MS / 1000,
          });

          const url = new URL("/oauth/authorize", origin);
          url.searchParams.set("client_id", client.clientId);
          url.searchParams.set("redirect_uri", redirectUri);
          url.searchParams.set("response_type", "code");
          url.searchParams.set("scope", SCOPE);
          url.searchParams.set("state", state);
          return ctx.json({ url: url.toString() });
        },
      ),

      mastodonCallback: createAuthEndpoint(
        "/mastodon/callback",
        {
          method: "GET",
          query: z.object({
            state: z.string().min(1),
            code: z.string().optional(),
            error: z.string().optional(),
          }),
        },
        async (ctx) => {
          const { state } = ctx.query;
          const cookie = ctx.getCookie(START_COOKIE);
          ctx.setCookie(START_COOKIE, "", { maxAge: 0, path: "/" });
          if (cookie !== state) {
            throw APIError.from("BAD_REQUEST", {
              message: MASTODON_ERROR.SESSION_MISMATCH,
              code: "session_mismatch",
            });
          }
          const record = await ctx.context.internalAdapter.consumeVerificationValue(
            `mastodon:${state}`,
          );
          if (!record) {
            throw APIError.from("BAD_REQUEST", {
              message: MASTODON_ERROR.SESSION_MISMATCH,
              code: "session_expired",
            });
          }
          const { host, origin, callbackURL } = JSON.parse(record.value) as {
            host: string;
            origin: string;
            callbackURL: string;
          };
          if (ctx.query.error || !ctx.query.code) {
            throw APIError.from("UNAUTHORIZED", {
              message: MASTODON_ERROR.CANCELLED,
              code: "access_denied",
            });
          }

          // code -> token -> 本人。token は保存せず、使ったら取り消す
          const client = await clientFor(host, origin);
          let account: z.infer<typeof accountSchema>;
          let accessToken: string;
          try {
            const tokenRes = await doFetch(`${origin}/oauth/token`, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code: ctx.query.code,
                client_id: client.clientId,
                client_secret: client.clientSecret,
                redirect_uri: redirectUri,
                scope: SCOPE,
              }).toString(),
              signal: AbortSignal.timeout(5000),
            });
            if (!tokenRes.ok) {
              throw APIError.from("UNAUTHORIZED", {
                message: MASTODON_ERROR.DENIED,
                code: "denied",
              });
            }
            accessToken = tokenSchema.parse(await tokenRes.json()).access_token;
            const meRes = await doFetch(`${origin}/api/v1/accounts/verify_credentials`, {
              headers: { authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(5000),
            });
            if (!meRes.ok) {
              throw APIError.from("UNAUTHORIZED", {
                message: MASTODON_ERROR.DENIED,
                code: "denied",
              });
            }
            account = accountSchema.parse(await meRes.json());
          } catch (e) {
            if (e instanceof APIError) throw e;
            throw APIError.from("BAD_REQUEST", {
              message: MASTODON_ERROR.HOST_UNAVAILABLE,
              code: "host_unavailable",
            });
          }
          // 取り消しは best effort (失敗してもログインは続ける。token はどこにも残らない)
          void doFetch(`${origin}/oauth/revoke`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: client.clientId,
              client_secret: client.clientSecret,
              token: accessToken,
            }).toString(),
            signal: AbortSignal.timeout(5000),
          }).catch(() => undefined);

          const accountKey = { providerId: "mastodon", accountId: `${host}:${account.id}` };
          const owner = await ctx.context.internalAdapter.findAccountOwnerByKey(accountKey);
          let user = owner?.kind === "owned" ? owner.user : null;
          const accountProfile = {
            displayName: account.username,
            imageUrl: account.avatar ?? null,
          };
          const refreshAccountProfile = async () => {
            const existing = await ctx.context.internalAdapter.findAccountByKey(accountKey);
            if (existing)
              await ctx.context.internalAdapter.updateAccount(
                existing.id,
                accountProfile as Record<string, unknown>,
              );
          };

          // ログイン済みなら連携モード (MiAuth と同じ)
          const current = await getSessionFromCtx(ctx).catch(() => null);
          if (current) {
            if (user && user.id !== current.user.id) {
              throw APIError.from("CONFLICT", {
                message: MASTODON_ERROR.ALREADY_LINKED,
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
                name: account.display_name || account.username,
                email: `${account.id}@mastodon-${host.replace(/[^a-z0-9]/g, "-")}.placeholder.invalid`,
                emailVerified: false,
                image: account.avatar ?? null,
              },
              { method: "mastodon" },
            );
            await ctx.context.internalAdapter.linkAccount({
              ...accountKey,
              userId: user.id,
              ...accountProfile,
            });
          } else await refreshAccountProfile();
          if ((user as { status?: string }).status === "suspended") {
            throw APIError.from("FORBIDDEN", {
              message: MASTODON_ERROR.SUSPENDED,
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
