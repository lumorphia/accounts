import { z } from "zod";
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
import { requireServiceAccess } from "../auth/service-access.ts";

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
      const access = await requireServiceAccess(app, req, reply, {
        scope: "lumorphia:characters",
        scopeError: "character_scope_required",
        realm: "characters",
      });
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
