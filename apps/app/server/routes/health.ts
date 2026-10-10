import { pingDatabase } from "@lumorphia-accounts/db";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { withErrors } from "../schemas/error.ts";
import { readWorkerHealth } from "../worker-health.ts";

const healthSchema = z.object({
  ok: z.boolean(),
  db: z.enum(["ok", "error"]),
  timestamp: z.string(),
  workers: z.object({
    accounts: z.enum(["ok", "stale", "disabled"]),
    characters: z.enum(["ok", "stale", "disabled"]),
  }),
});

/** DB と有効な worker の死活確認。異常は503で外側の監視へ知らせる。 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["ops"],
        summary: "死活確認",
        response: withErrors({ 200: healthSchema, 503: healthSchema }),
      },
      config: { rateLimit: false },
    },
    async (req, reply) => {
      let db: "ok" | "error" = "ok";
      let workers: Awaited<ReturnType<typeof readWorkerHealth>> = {
        accounts: app.env.FEATURE_ACCOUNT_LIFECYCLE ? "stale" : "disabled",
        characters: app.env.FEATURE_LODESTONE ? "stale" : "disabled",
      };
      try {
        await pingDatabase(app.db);
        workers = await readWorkerHealth(app.db, {
          accounts: app.env.FEATURE_ACCOUNT_LIFECYCLE,
          characters: app.env.FEATURE_LODESTONE,
        });
      } catch (err) {
        req.log.warn({ err }, "health: database did not answer");
        db = "error";
      }
      const ok = db === "ok" && workers.accounts !== "stale" && workers.characters !== "stale";
      return reply
        .code(ok ? 200 : 503)
        .send({ ok, db, workers, timestamp: new Date().toISOString() });
    },
  );
};
