import { pathToFileURL } from "node:url";
import { fastifyReactRouter } from "@mcansh/react-router-fastify";
import type { ViteDevServer } from "vite";
import { buildApp } from "./app.ts";
import { handleShutdownSignals } from "./graceful-shutdown.ts";

/**
 * @mcansh/react-router-fastify が要求するファクトリ。
 * 開発時は Vite dev server が渡され、本番では undefined。
 */
export async function createServer(vite?: ViteDevServer) {
  const app = await buildApp();

  await app.register(fastifyReactRouter, {
    ...(vite ? { devServer: vite } : {}),
    assetCacheControl: "public, max-age=31536000, immutable",
    // catch-all を OpenAPI に載せない
    routeOptions: { schema: { hide: true } },
  });

  return app;
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (import.meta.url === entryPoint) {
  const app = await createServer();
  // 入れ替えで SIGTERM を受けたら、処理中のリクエストを待ってから終わる (lumorphia/prismtone#307)
  handleShutdownSignals(app);
  await app.listen({ port: app.env.PORT, host: app.env.HOST });
}
