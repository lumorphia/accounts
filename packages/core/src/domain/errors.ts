export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal";

/** ドメイン層が投げる例外。HTTP への変換は API 層のエラーハンドラが行う (lumorphia/prismtone の docs/design/05 §4 と同じ)。 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
