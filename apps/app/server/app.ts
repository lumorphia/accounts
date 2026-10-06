import { randomUUID } from "node:crypto";
import { fastify, type FastifyInstance } from "fastify";
import underPressure from "@fastify/under-pressure";
import rateLimit from "@fastify/rate-limit";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { loggerOptions } from "@lumorphia/ops/logger";
import { loadEnv, type Env } from "./env.ts";
import { clientIp } from "./client-ip.ts";
import { dbPlugin } from "./plugins/db.ts";
import { securityPlugin } from "./plugins/security.ts";
import { errorsPlugin } from "./plugins/errors.ts";
import { healthRoutes } from "./routes/health.ts";
import { devTlsOptions } from "./tls.ts";
import { captureServerException, type CaptureException } from "./sentry.ts";

export type BuildAppOptions = {
  env?: Env;
  /** テストで DB をつながずに組み立てる。DB を使うと失敗する */
  skipDb?: boolean;
  /** テスト用: 未知の 500 エラーの外部通知を差し替える */
  captureException?: CaptureException;
};

/**
 * Fastify インスタンスを組み立てる。listen はしない。
 * テストは buildApp() の戻り値に対して app.inject() を使う (lumorphia/prismtone と同じ)。
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();

  // 開発と E2E は https で待ち受ける (tls.ts)。型は http のインスタンスとして扱う (Fastify の型は https でも同じ形)
  const https = devTlsOptions(process.env);
  const app = fastify({
    ...(https ? { https } : {}),
    genReqId: () => randomUUID(),
    logger: loggerOptions({ level: env.LOG_LEVEL }),
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("env", env);

  await app.register(errorsPlugin, {
    captureException: opts.captureException ?? captureServerException,
  });
  await app.register(securityPlugin);
  if (!opts.skipDb) {
    await app.register(dbPlugin, { connectionString: env.DATABASE_URL });
  } else {
    // 呼び出した時点で失敗させる。プロパティ参照は許す (Fastify や Promise の内部検査のため)
    const unavailable = () => {
      throw new Error("database is not configured (skipDb)");
    };
    app.decorate(
      "db",
      new Proxy(
        {},
        { get: (_t, key) => (typeof key === "symbol" || key === "then" ? undefined : unavailable) },
      ) as FastifyInstance["db"],
    );
  }
  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 1_500_000_000,
    exposeStatusRoute: false,
  });

  // E2E 専用。production では無視する
  const rateLimitDisabled = env.API_RATE_LIMIT_DISABLED && env.NODE_ENV !== "production";
  if (rateLimitDisabled) app.log.warn("API rate limit disabled (API_RATE_LIMIT_DISABLED)");
  await app.register(
    async (api) => {
      // レート制限は /api 配下だけ。ページや静的アセットにはかけない
      await api.register(rateLimit, {
        global: true,
        max: env.API_RATE_LIMIT_PER_MINUTE,
        timeWindow: "1 minute",
        keyGenerator: (req) => clientIp(req, env.CLIENT_IP_HEADER),
        allowList: () => rateLimitDisabled,
      });
      await api.register(healthRoutes);
      // /api 配下の未知のパスは React Router の catch-all (/*) ではなく JSON の 404 を返す
      api.all("/*", { schema: { hide: true } }, async (req, reply) => {
        return reply.code(404).send({
          error: { code: "not_found", message: `route not found: ${req.method} ${req.url}` },
        });
      });
    },
    { prefix: "/api" },
  );

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
  }
}
