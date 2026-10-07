import fp from "fastify-plugin";
import { createDatabase } from "@lumorphia-accounts/db";
import {
  HttpLodestoneSource,
  PostgresLodestonePacer,
} from "@lumorphia-accounts/core/adapters/lodestone";
import type { CharacterDeps } from "@lumorphia-accounts/core";
import { startCharacterQueue } from "@lumorphia-accounts/core/jobs";

export type CharacterPluginOptions = {
  lodestone?: CharacterDeps["lodestone"];
  characterJobs?: CharacterDeps["jobs"];
};

declare module "fastify" {
  interface FastifyInstance {
    characters: CharacterDeps;
  }
}

export const characterPlugin = fp<CharacterPluginOptions>(
  async (app, opts) => {
    // 同期が利用者のトランザクションを保持していても、共有取得ロックの接続は確保できる。
    const pacing = opts.lodestone
      ? undefined
      : createDatabase(app.env.DATABASE_URL, {
          maxConnections: 1,
          onIdleError: (err) => app.log.error({ err }, "lodestone pacing database error"),
        });
    if (pacing) app.addHook("onClose", () => pacing.close());
    const lodestone =
      opts.lodestone ??
      new HttpLodestoneSource({
        baseUrl: app.env.LODESTONE_BASE_URL,
        userAgent: app.env.LODESTONE_USER_AGENT ?? "lumorphia-accounts/dev",
        pacer: new PostgresLodestonePacer(pacing!.db),
      });
    const producer = opts.characterJobs
      ? undefined
      : await startCharacterQueue(app.env.DATABASE_URL, app.log);
    if (producer) app.addHook("onClose", () => producer.stop());
    app.decorate("characters", {
      db: app.db,
      lodestone,
      jobs: opts.characterJobs ?? producer!.queue,
      enabled: app.env.FEATURE_LODESTONE,
    });
  },
  { name: "characters", dependencies: ["db"] },
);
