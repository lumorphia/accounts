import { z } from "zod";
import { withErrors } from "../schemas/error.ts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/** トップには表示に必要な情報だけを渡す。共通Cookieや変更APIのCORSは設けない。 */
export const websiteSessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/website/session",
    {
      schema: {
        response: withErrors({
          200: z.object({
            user: z
              .object({
                name: z.string(),
                handle: z.string(),
                image: z.string().nullable(),
              })
              .nullable(),
          }),
        }),
      },
      onRequest: async (req, reply) => {
        reply.header("cache-control", "private, no-store").header("vary", "Origin");
        if (req.headers.origin !== app.env.WEBSITE_ORIGIN) {
          return reply.code(403).send({ error: { code: "forbidden", message: "origin mismatch" } });
        }
        reply
          .header("access-control-allow-origin", app.env.WEBSITE_ORIGIN)
          .header("access-control-allow-credentials", "true");
      },
      preValidation: [app.optionalAuth],
    },
    async (req) => ({
      user:
        req.user?.status === "active"
          ? {
              name: req.user.name,
              handle: req.user.handle ?? "",
              image: req.user.image ?? null,
            }
          : null,
    }),
  );
};

/** トップのログアウトフォーム専用。GETでは変更せず、許可したOriginだけを受け付ける。 */
export const websiteLogoutRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );
  app.post("/logout", async (req, reply) => {
    reply.header("cache-control", "private, no-store");
    if (
      ![app.env.WEBSITE_ORIGIN, new URL(app.env.AUTH_BASE_URL).origin].includes(
        req.headers.origin ?? "",
      )
    )
      return reply.code(403).send({ error: { code: "forbidden", message: "origin mismatch" } });
    const response = await app.auth.handler(
      new Request(new URL("/api/auth/sign-out", app.env.AUTH_BASE_URL), {
        method: "POST",
        headers: {
          cookie: req.headers.cookie ?? "",
          origin: new URL(app.env.AUTH_BASE_URL).origin,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    if (!response.ok)
      return reply.code(502).send({
        error: {
          code: "unavailable",
          message: "ログアウトできませんでした。もう一度お試しください。",
        },
      });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    for (const header of ["content-security-policy", "content-security-policy-report-only"]) {
      const policy = reply.getHeader(header);
      if (typeof policy === "string")
        reply.header(
          header,
          policy.replace("form-action 'self'", `form-action 'self' ${app.env.WEBSITE_ORIGIN}`),
        );
    }
    return reply.code(303).header("location", `${app.env.WEBSITE_ORIGIN}/`).send();
  });
};
