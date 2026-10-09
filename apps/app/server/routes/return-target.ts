import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { returnTargetOf, SERVICES } from "@lumorphia-accounts/core";
import { withErrors } from "../schemas/error.ts";

/** 設定画面の「サービスに戻る」。return_to が登録したサービスの URL のときだけ返す (prismtone ADR-0052) */
export const returnTargetRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/return-target",
    {
      preValidation: [app.requireSession],
      schema: {
        querystring: z.object({ url: z.string().max(2048) }).strict(),
        response: withErrors({
          200: z.object({
            target: z.object({ service: z.enum(SERVICES), url: z.string() }).nullable(),
          }),
        }),
      },
    },
    async (req, reply) => {
      reply.header("cache-control", "no-store");
      return { target: await returnTargetOf(app.db, req.query.url) };
    },
  );
};
