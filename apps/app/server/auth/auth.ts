import { randomBytes } from "node:crypto";
import { PENDING_HANDLE_PREFIX } from "@lumorphia-accounts/core";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "@lumorphia-accounts/db";
import * as schema from "@lumorphia-accounts/db/schema";
import type { Env } from "../env.ts";
import { devLogin } from "./dev-login.ts";
import { resolveAccountProfile, withAccountProfile } from "./account-display-name.ts";
import { miauth } from "./miauth.ts";
import { mastodon } from "./mastodon.ts";
import { installOAuthMockFetch } from "./oauth-mock-fetch.ts";

export type AuthDeps = {
  db: Database;
  env: Env;
  miauthFetch?: typeof fetch;
  mastodonFetch?: typeof fetch;
};
const DAY = 24 * 60 * 60;

export function createAuth({ db, env, miauthFetch, mastodonFetch }: AuthDeps) {
  if (env.OAUTH_MOCK_BASE_URL && env.NODE_ENV !== "production")
    installOAuthMockFetch(env.OAUTH_MOCK_BASE_URL);
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (env.AUTH_DISCORD_ID && env.AUTH_DISCORD_SECRET)
    socialProviders.discord = {
      clientId: env.AUTH_DISCORD_ID,
      clientSecret: env.AUTH_DISCORD_SECRET,
      prompt: "consent",
    };
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET)
    socialProviders.google = {
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
    };
  if (env.AUTH_X_ID && env.AUTH_X_SECRET)
    socialProviders.twitter = {
      clientId: env.AUTH_X_ID,
      clientSecret: env.AUTH_X_SECRET,
    };

  return betterAuth({
    appName: "Lumorphia",
    baseURL: env.AUTH_BASE_URL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.AUTH_BASE_URL],
    onAPIError: { errorURL: `${env.AUTH_BASE_URL}/login` },
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    advanced: {
      database: { generateId: false },
      cookiePrefix: "lumorphia",
      useSecureCookies: true,
      ipAddress: {
        ipAddressHeaders: env.CLIENT_IP_HEADER
          ? [env.CLIENT_IP_HEADER, "x-forwarded-for"]
          : ["x-forwarded-for"],
      },
    },
    session: { expiresIn: 30 * DAY, updateAge: DAY, cookieCache: { enabled: false } },
    emailAndPassword: { enabled: false },
    socialProviders,
    account: {
      accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: true },
      additionalFields: {
        displayName: { type: "string", required: false, input: false },
        imageUrl: { type: "string", required: false, input: false },
      },
    },
    user: {
      additionalFields: {
        handle: { type: "string", required: false, input: false },
        role: { type: "string", required: false, input: false, defaultValue: "user" },
        status: { type: "string", required: false, input: false, defaultValue: "pending" },
        handleChangedAt: { type: "date", required: false, input: false },
      },
      deleteUser: { enabled: false },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account, ctx) => {
            const fields = await resolveAccountProfile(account, ctx?.context.socialProviders ?? []);
            return { data: withAccountProfile(account, fields) };
          },
        },
        update: {
          before: async (account, ctx) => {
            const fields = await resolveAccountProfile(account, ctx?.context.socialProviders ?? []);
            return { data: withAccountProfile(account, fields) };
          },
        },
      },
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              handle: `${PENDING_HANDLE_PREFIX}${randomBytes(6).toString("hex")}`,
              role: "user",
              status: "pending",
            },
          }),
        },
      },
    },
    plugins: [
      ...(env.NODE_ENV === "production" ? [] : [devLogin({ db })]),
      miauth({
        appName: "Lumorphia",
        baseURL: env.AUTH_BASE_URL,
        policy: {
          blockedHosts: env.MIAUTH_BLOCKED_HOSTS.split(",").filter(Boolean),
          devHosts: env.MIAUTH_DEV_HOSTS.split(",").filter(Boolean),
        },
        isProduction: env.NODE_ENV === "production",
        ...(miauthFetch ? { fetch: miauthFetch } : {}),
      }),
      mastodon({
        appName: "Lumorphia",
        baseURL: env.AUTH_BASE_URL,
        db,
        policy: {
          blockedHosts: env.MIAUTH_BLOCKED_HOSTS.split(",").filter(Boolean),
          devHosts: env.MASTODON_DEV_HOSTS.split(",").filter(Boolean),
        },
        isProduction: env.NODE_ENV === "production",
        ...(mastodonFetch ? { fetch: mastodonFetch } : {}),
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth["$Infer"]["Session"]["user"];
export type Session = Auth["$Infer"]["Session"]["session"];
