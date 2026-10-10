/**
 * リリースの後も開いたままのタブが、前の版のファイル (名前にハッシュが付いた /assets/*.js) を
 * 取りに行って失敗したときの扱い。
 *
 * React Router は、clientLoader などを分けたファイル (edit-client-loader-*.js) を先読みするとき
 * import を投げっぱなしにしていて、取れないと unhandledrejection になる (8.4.0)。前の版のファイルは
 * リリースで消えるので、開いたままのタブではリリースのたびに起きる。
 * ページを移るときにルートのモジュールが取れなければ、React Router が自分で今のページを読み直し、
 * 新しい版になる (もう一度押せば移れる)。なので、先読みの失敗はエラーにも Sentry にもしない
 */

/** 動的 import の失敗。Chrome / Firefox / Safari で文言が違う */
const STALE_CHUNK_MESSAGES = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

export function isStaleChunkError(error: unknown): boolean {
  const message =
    typeof error === "string" ? error : error instanceof Error ? error.message : undefined;
  return message !== undefined && STALE_CHUNK_MESSAGES.some((re) => re.test(message));
}

/** 先読みで前の版のファイルが取れなかったときに、未処理のエラーにしない。entry.client で一度呼ぶ */
export function ignoreStaleChunkPrefetchErrors(): void {
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleChunkError(event.reason)) event.preventDefault();
  });
}
