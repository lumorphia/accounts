import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { createAuth, type Auth, type Session, type SessionUser } from "../auth/auth.ts";
import { isPublicAuthPath } from "../auth/public-endpoints.ts";
import { DomainError } from "./errors.ts";

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
    optionalAuth: (req: FastifyRequest) => Promise<void>;
    requireSession: (req: FastifyRequest) => Promise<void>;
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requireAdmin: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    session: Session | null;
  }
}

export type AuthPluginOptions = { miauthFetch?: typeof fetch; mastodonFetch?: typeof fetch };

/** Better Auth の Web Request を Fastify に渡し、API 用の認証フックを提供する。 */
export const authPlugin = fp<AuthPluginOptions>(
  async (app, opts) => {
    const auth = createAuth({
      db: app.db,
      env: app.env,
      ...(opts.miauthFetch ? { miauthFetch: opts.miauthFetch } : {}),
      ...(opts.mastodonFetch ? { mastodonFetch: opts.mastodonFetch } : {}),
    });
    app.decorate("auth", auth);
    app.decorateRequest("user", null);
    app.decorateRequest("session", null);

    app.register(async (scope) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) =>
        done(null, body),
      );
      scope.route({
        method: ["GET", "POST"],
        url: "/api/auth/*",
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: { hide: true },
        handler: async (req, reply) => {
          const url = new URL(req.url, `${req.protocol}://${req.headers.host ?? "localhost"}`);
          // 許可リストの外は、Better Auth に渡さずに /api の未知のパスと同じ 404 を返す
          if (!isPublicAuthPath(url.pathname))
            return reply.code(404).send({
              error: {
                code: "not_found",
                message: `route not found: ${req.method} ${url.pathname}`,
              },
            });
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value !== undefined)
              headers.append(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const body = req.method === "GET" ? undefined : (req.body as Buffer | undefined);
          const response = await auth.handler(
            new Request(url, {
              method: req.method,
              headers,
              ...(body?.length ? { body: new Uint8Array(body) } : {}),
            }),
          );
          reply.status(response.status);
          response.headers.forEach((value, key) => {
            if (key !== "set-cookie") reply.header(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) reply.header("set-cookie", cookies);
          return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
        },
      });
    });

    const load = async (req: FastifyRequest) => {
      const headers = new Headers();
      if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
      const result = await auth.api.getSession({ headers });
      req.user = result?.user ?? null;
      req.session = result?.session ?? null;
    };
    app.decorate("optionalAuth", load);
    app.decorate("requireSession", async (req: FastifyRequest) => {
      await load(req);
      if (!req.user) throw new DomainError("unauthorized", "login required");
      if (req.user.status === "suspended") throw new DomainError("forbidden", "account suspended");
      if (req.user.status === "deleted") throw new DomainError("unauthorized", "account deleted");
    });
    app.decorate("requireAuth", async (req: FastifyRequest) => {
      await app.requireSession(req);
      if (req.user?.status === "pending") throw new DomainError("forbidden", "onboarding required");
    });
    app.decorate("requireAdmin", async (req: FastifyRequest) => {
      await app.requireAuth(req);
      if (req.user?.role !== "admin") throw new DomainError("forbidden", "admin only");
    });
  },
  { name: "auth", dependencies: ["db", "errors"] },
);
