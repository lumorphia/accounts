import { z } from "zod";
import { APIError } from "better-auth/api";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { eq, schema } from "@lumorphia-accounts/db";
import {
  checkVerification,
  deleteCharacter,
  listCharacters,
  registerCharacter,
  reissueToken,
  requestSync,
  setPrimaryCharacter,
} from "@lumorphia-accounts/core";
import { DomainError } from "../plugins/errors.ts";
import { withErrors } from "../schemas/error.ts";

const commonSchema = z.object({
  id: z.string().uuid(),
  lodestoneId: z.string(),
  name: z.string(),
  world: z.string(),
  dataCenter: z.string(),
  race: z.string().nullable(),
  clan: z.string().nullable(),
  gender: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isPrimary: z.boolean(),
  verified: z.boolean(),
  verifiedAt: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
});
const ownerSchema = commonSchema.extend({
  verification: z.object({ token: z.string(), expiresAt: z.string() }).nullable(),
  verificationError: z.string().nullable(),
  verificationCheckedAt: z.string().nullable(),
  syncError: z.string().nullable(),
});
const characterResponse = z.object({ character: ownerSchema });
const ok = z.object({ ok: z.literal(true) });
const params = z.object({ id: z.string().uuid() });
const registration = z.union([
  z.object({ lodestone: z.string().trim().min(1).max(512) }).strict(),
  z
    .object({
      name: z.string().trim().min(1).max(40),
      world: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{1,40}$/),
    })
    .strict(),
]);
const limited = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export const characterRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/me/characters") || req.url.startsWith("/api/characters"))
      reply.header("cache-control", "no-store");
  });
  app.get(
    "/me/characters",
    {
      preValidation: [app.requireAuth],
      schema: {
        response: withErrors({
          200: z.object({ enabled: z.boolean(), characters: z.array(ownerSchema) }),
        }),
      },
    },
    async (req) => ({
      enabled: app.characters.enabled,
      characters: await listCharacters(app.db, req.user!.id),
    }),
  );
  app.post(
    "/me/characters",
    {
      preValidation: [app.requireAuth],
      config: limited,
      schema: { body: registration, response: withErrors({ 201: characterResponse }) },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send({ character: await registerCharacter(app.characters, req.user!.id, req.body) }),
  );
  app.post(
    "/me/characters/:id/token",
    {
      preValidation: [app.requireAuth],
      config: limited,
      schema: { params, response: withErrors({ 200: characterResponse }) },
    },
    async (req) => ({ character: await reissueToken(app.characters, req.user!.id, req.params.id) }),
  );
  app.post(
    "/me/characters/:id/verify",
    {
      preValidation: [app.requireAuth],
      config: limited,
      schema: {
        params,
        response: withErrors({
          200: characterResponse.extend({
            result: z.enum([
              "verified",
              "token_not_found",
              "token_expired",
              "already_verified_by_another_user",
              "lodestone_error",
              "skipped",
            ]),
          }),
        }),
      },
    },
    async (req) => checkVerification(app.characters, req.user!.id, req.params.id),
  );
  app.post(
    "/me/characters/:id/sync",
    {
      preValidation: [app.requireAuth],
      config: limited,
      schema: { params, response: withErrors({ 202: ok }) },
    },
    async (req, reply) => {
      await requestSync(app.characters, req.user!.id, req.params.id);
      return reply.code(202).send({ ok: true });
    },
  );
  app.put(
    "/me/characters/:id/primary",
    { preValidation: [app.requireAuth], schema: { params, response: withErrors({ 200: ok }) } },
    async (req) => {
      await setPrimaryCharacter(app.db, req.user!.id, req.params.id);
      return { ok: true as const };
    },
  );
  app.delete(
    "/me/characters/:id",
    { preValidation: [app.requireAuth], schema: { params, response: withErrors({ 200: ok }) } },
    async (req) => {
      await deleteCharacter(app.db, req.user!.id, req.params.id);
      return { ok: true as const };
    },
  );

  app.get(
    "/characters",
    {
      schema: {
        querystring: z.object({}).strict(),
        response: withErrors({ 200: z.object({ characters: z.array(commonSchema) }) }),
      },
    },
    async (req, reply) => {
      const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "");
      if (!match) {
        reply.header("www-authenticate", 'Bearer realm="characters"');
        throw new DomainError("unauthorized", "access_token_required");
      }
      const access = await app.auth.api
        .characterAccess({ body: { token: match[1]! } })
        .catch((error: unknown) => {
          if (!(error instanceof APIError)) throw error;
          reply.header("www-authenticate", 'Bearer error="invalid_token"');
          throw new DomainError("unauthorized", "invalid_access_token");
        });
      // この API は登録済みサービスの、本人が許可した読み取りだけを扱う。
      const client =
        typeof access.client_id === "string"
          ? await app.db.query.oauthClients.findFirst({
              where: eq(schema.oauthClients.clientId, access.client_id),
            })
          : undefined;
      if (
        !client ||
        client.disabled ||
        !["prismtone", "scenote", "facetia"].includes(client.name ?? "") ||
        !client.scopes?.includes("lumorphia:characters") ||
        access.token_type !== "Bearer" ||
        access.cnf ||
        !access.sub
      ) {
        reply.header("www-authenticate", 'Bearer error="invalid_token"');
        throw new DomainError("unauthorized", "invalid_access_token");
      }
      if (
        typeof access.scope !== "string" ||
        !access.scope.split(" ").includes("lumorphia:characters")
      ) {
        reply.header(
          "www-authenticate",
          'Bearer error="insufficient_scope", scope="lumorphia:characters"',
        );
        throw new DomainError("forbidden", "character_scope_required");
      }
      const user = await app.db.query.users.findFirst({
        where: eq(schema.users.id, access.sub),
        columns: { status: true },
      });
      if (!user || user.status !== "active")
        throw new DomainError("forbidden", "account_not_active");
      const characters = await listCharacters(app.db, access.sub);
      // 公開する項目を明示し、所有確認用トークンや運用上のエラーを渡さない。
      return { characters: characters.filter((c) => c.verified).map((c) => commonSchema.parse(c)) };
    },
  );
};
