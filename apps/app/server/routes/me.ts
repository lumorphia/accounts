import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { withErrors } from "../schemas/error.ts";

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      schema: {
        tags: ["auth"],
        summary: "ログイン中の利用者",
        response: withErrors({
          200: z.object({
            user: z
              .object({
                id: z.string(),
                name: z.string(),
                handle: z.string(),
                image: z.string().nullable(),
                role: z.enum(["user", "admin"]),
                status: z.enum(["pending", "active", "suspended", "deleted"]),
              })
              .nullable(),
          }),
        }),
      },
      preValidation: [app.optionalAuth],
    },
    async (req) => ({
      user: req.user
        ? {
            id: req.user.id,
            name: req.user.name,
            handle: req.user.handle ?? "",
            image: req.user.image ?? null,
            role: req.user.role === "admin" ? ("admin" as const) : ("user" as const),
            status: req.user.status as "pending" | "active" | "suspended" | "deleted",
          }
        : null,
    }),
  );
};
