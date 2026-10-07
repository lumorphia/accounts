import { z } from "zod";
import { APIError } from "better-auth/api";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { eq, schema } from "@lumorphia-accounts/db";
import { completeLegacyMigration, listLegacyPending } from "@lumorphia-accounts/core";
import { DomainError } from "../plugins/errors.ts";
import { withErrors } from "../schemas/error.ts";

export const legacyLedgerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/me/legacy") || req.url.startsWith("/api/legacy/"))
      reply.header("cache-control", "no-store");
  });
  app.get(
    "/me/legacy",
    {
      preValidation: [app.requireSession],
      schema: {
        response: withErrors({
          200: z.object({
            accounts: z.array(
              z.object({
                service: z.literal("prismtone"),
                handle: z.string(),
                migrationUrl: z.string(),
              }),
            ),
          }),
        }),
      },
    },
    async (req) => ({
      accounts: (await listLegacyPending(app.db, req.user!.id)).map((row) => ({
        ...row,
        migrationUrl: app.env.LEGACY_PRISMTONE_MIGRATION_URL,
      })),
    }),
  );
  app.post(
    "/legacy/prismtone/complete",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: z
          .object({ legacyUserId: z.string().uuid(), handleChoice: z.enum(["legacy", "current"]) })
          .strict(),
        response: withErrors({
          200: z.object({ handle: z.string(), alreadyCompleted: z.boolean() }),
        }),
      },
    },
    async (req, reply) => {
      const bearer = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "");
      if (!bearer) {
        reply.header("www-authenticate", 'Bearer realm="legacy"');
        throw new DomainError("unauthorized", "access_token_required");
      }
      const access = await app.auth.api
        .legacyAccess({ body: { token: bearer[1]! } })
        .catch((error: unknown) => {
          if (!(error instanceof APIError)) throw error;
          throw new DomainError("unauthorized", "invalid_access_token");
        });
      const client =
        typeof access.client_id === "string"
          ? await app.db.query.oauthClients.findFirst({
              where: eq(schema.oauthClients.clientId, access.client_id),
            })
          : undefined;
      if (
        !client ||
        client.disabled ||
        client.name !== "prismtone" ||
        access.token_type !== "Bearer" ||
        access.cnf ||
        !access.sub
      )
        throw new DomainError("unauthorized", "invalid_access_token");
      if (
        !client.scopes?.includes("lumorphia:legacy") ||
        typeof access.scope !== "string" ||
        !access.scope.split(" ").includes("lumorphia:legacy")
      ) {
        reply.header(
          "www-authenticate",
          'Bearer error="insufficient_scope", scope="lumorphia:legacy"',
        );
        throw new DomainError("forbidden", "legacy_scope_required");
      }
      return completeLegacyMigration(
        app.db,
        access.sub,
        req.body.legacyUserId,
        req.body.handleChoice,
      );
    },
  );
};
