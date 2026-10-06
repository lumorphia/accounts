/** アカウント ID (@handle) の規則 (ADR-0017)。ブラウザとサーバーで同じ判定を使う */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
/** ID を変更 (確定を含む) してから再変更できるまでの日数 */
export const HANDLE_CHANGE_COOLDOWN_DAYS = 30;
/** 確定前の仮 ID の接頭辞。利用者は選べない */
export const PENDING_HANDLE_PREFIX = "pending_";

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "moderator",
  "root",
  "system",
  "support",
  "help",
  "me",
  "settings",
  "login",
  "logout",
  "welcome",
  "signup",
  "signin",
  "posts",
  "post",
  "items",
  "item",
  "u",
  "user",
  "users",
  "api",
  "auth",
  "about",
  "terms",
  "privacy",
  "edit",
  "editor",
  "prismtone",
  "lumorphia",
  "official",
  "null",
  "undefined",
  "anonymous",
  "everyone",
]);

export type HandleValidation = { ok: true } | { ok: false; reason: "invalid" | "reserved" };

export function isPendingHandle(value: string): boolean {
  return value.startsWith(PENDING_HANDLE_PREFIX);
}

export function validateHandle(value: string): HandleValidation {
  if (!HANDLE_PATTERN.test(value)) return { ok: false, reason: "invalid" };
  if (RESERVED_HANDLES.has(value) || isPendingHandle(value))
    return { ok: false, reason: "reserved" };
  return { ok: true };
}

/** 表示名から ID の候補を作る。規則に合わなければ空文字 (利用者に入力してもらう) */
export function suggestHandle(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, HANDLE_MAX_LENGTH)
    .replace(/_+$/, "");
}
