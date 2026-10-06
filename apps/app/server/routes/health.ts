import { pingDatabase } from "@lumorphia-accounts/db";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { withErrors } from "../schemas/error.ts";

const healthSchema = z.object({
  ok: z.boolean(),
  db: z.enum(["ok", "error"]),
  timestamp: z.string(),
});

/** 死活確認。DB に 1 行問い合わせ、答えれば 200、だめなら 503 (外側の監視が見る) */
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
      try {
        await pingDatabase(app.db);
      } catch (err) {
        req.log.warn({ err }, "health: database did not answer");
        db = "error";
      }
      const ok = db === "ok";
      return reply.code(ok ? 200 : 503).send({ ok, db, timestamp: new Date().toISOString() });
    },
  );
};
