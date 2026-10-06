import fp from "fastify-plugin";
import { createDatabase, type Database } from "@lumorphia-accounts/db";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

export const dbPlugin = fp<{ connectionString: string }>(
  async (app, opts) => {
    const { db, close } = createDatabase(opts.connectionString, {
      onIdleError: (err) => app.log.warn({ err }, "db: idle client disconnected"),
    });
    app.decorate("db", db);
    app.addHook("onClose", async () => {
      await close();
    });
  },
  { name: "db" },
);
