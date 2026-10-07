import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { completeLegacyMigration, listLegacyPending } from "@lumorphia-accounts/core";
import { withErrors } from "../schemas/error.ts";
import { requireServiceAccess } from "../auth/service-access.ts";

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
      const access = await requireServiceAccess(app, req, reply, {
        scope: "lumorphia:legacy",
        scopeError: "legacy_scope_required",
        realm: "legacy",
        services: ["prismtone"],
      });
      return completeLegacyMigration(
        app.db,
        access.sub,
        req.body.legacyUserId,
        req.body.handleChoice,
      );
    },
  );
};
