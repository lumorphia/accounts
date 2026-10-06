/**
 * web の graceful shutdown (lumorphia/prismtone#307)。SIGTERM / SIGINT で app.close() を呼び、処理中のリクエストを待ってから終わる。
 * Fastify の close() は、新しい接続の受け付けをやめ、待ちの間に来たリクエストには 503 を返し、処理中のものを
 * 待ってから onClose (DB のプール、pg-boss) を流す。入れ替え (doco-cd の docker compose up) で、投稿や
 * アップロードが途中で切れないようにする。
 * Docker は SIGTERM の後 stop_grace_period で SIGKILL するので、timeoutMs はそれより短くする (compose.prod.yaml)
 */
export const SHUTDOWN_TIMEOUT_MS = 25_000;

type Closable = {
  close: () => Promise<unknown>;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
};

/**
 * シグナルを受けたときの処理を返す。1 回目は close して 0 (失敗・時間切れは 1) で終わる。
 * close の途中で 2 回目のシグナルが来たら、待たずに 1 で終わる (手元の Ctrl-C を 2 回押したとき)
 */
export function createShutdown(
  app: Closable,
  opts: { timeoutMs: number; exit: (code: number) => void },
): (signal: string) => Promise<void> {
  let closing = false;
  return async (signal) => {
    if (closing) {
      app.log.warn({ signal }, "second signal while shutting down, exiting now");
      opts.exit(1);
      return;
    }
    closing = true;
    app.log.info({ signal, timeoutMs: opts.timeoutMs }, "shutting down");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), opts.timeoutMs);
    });
    try {
      const result = await Promise.race([app.close().then(() => "closed" as const), timedOut]);
      if (result === "timeout") {
        app.log.warn({ timeoutMs: opts.timeoutMs }, "in-flight requests outlasted the timeout");
        opts.exit(1);
        return;
      }
      app.log.info({}, "shut down");
      opts.exit(0);
    } catch (err) {
      app.log.error({ err }, "failed to shut down");
      opts.exit(1);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** process のシグナルに graceful shutdown を付ける */
export function handleShutdownSignals(app: Closable, timeoutMs = SHUTDOWN_TIMEOUT_MS): void {
  const shutdown = createShutdown(app, { timeoutMs, exit: (code) => process.exit(code) });
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
