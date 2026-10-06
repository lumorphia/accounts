import { z } from "zod";

/** 統一エラー形式 (lumorphia/prismtone の docs/design/05 §1 と同じ) */
export const errorSchema = z.object({
  error: z.object({
    code: z.enum([
      "validation",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "rate_limited",
      "upstream_unavailable",
      "internal",
    ]),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/** 成功レスポンスに共通のエラー応答を足す。OpenAPI 生成と openapi-fetch の error 型のため */
export function withErrors<T extends Record<number, z.ZodTypeAny>>(ok: T) {
  return {
    ...ok,
    400: errorSchema,
    401: errorSchema,
    403: errorSchema,
    404: errorSchema,
    429: errorSchema,
    500: errorSchema,
  };
}
