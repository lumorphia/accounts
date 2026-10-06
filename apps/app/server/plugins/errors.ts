import fp from "fastify-plugin";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

import { DomainError, type ErrorCode } from "@lumorphia-accounts/core";
import type { CaptureException } from "../sentry.ts";

export { DomainError };

/**
 * instanceof に頼らない判定。テストランナーやバンドラの都合で同じソースが
 * 2 つのモジュールインスタンスになっても正しく分類できるようにする。
 */
function isDomainError(err: unknown): err is DomainError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "DomainError" &&
    typeof (err as { code?: unknown }).code === "string" &&
    (err as { code: string }).code in STATUS
  );
}

const STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal: 500,
};

// 統一エラー形式 { error: { code, message } } (lumorphia/prismtone の docs/design/05 §1 と同じ)
type ErrorsPluginOptions = { captureException?: CaptureException };

export const errorsPlugin = fp<ErrorsPluginOptions>(
  async (app, opts) => {
    app.setErrorHandler((err: unknown, req, reply) => {
      if (hasZodFastifySchemaValidationErrors(err)) {
        return reply.code(400).send({
          error: {
            code: "validation",
            message: "invalid request",
            issues: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
          },
        });
      }
      if (isDomainError(err)) {
        return reply
          .code(STATUS[err.code])
          .send({ error: { code: err.code, message: err.message } });
      }
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 429) {
        return reply
          .code(429)
          .send({ error: { code: "rate_limited", message: "too many requests" } });
      }
      if (statusCode && statusCode < 500) {
        const message = err instanceof Error ? err.message : "bad request";
        return reply.code(statusCode).send({ error: { code: "validation", message } });
      }
      opts.captureException?.(err, {
        runtime: "server",
        method: req.method,
        route: req.routeOptions.url ?? "unknown",
        requestId: req.id,
      });
      req.log.error({ err }, "unhandled error");
      return reply.code(500).send({ error: { code: "internal", message: "internal error" } });
    });
  },
  { name: "errors" },
);
