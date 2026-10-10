import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDatabase } from "@lumorphia-accounts/db";
import { createAuth } from "../apps/app/server/auth/auth.ts";
import {
  registerServiceClient,
  type ServiceClientConfig,
} from "../apps/app/server/auth/oidc-clients.ts";
import { loadEnv } from "../apps/app/server/env.ts";

const { values } = parseArgs({
  options: { config: { type: "string" }, output: { type: "string" } },
});
if (!values.config || !values.output || !process.env.OIDC_ADMIN_COOKIE)
  throw new Error("--config / --output / OIDC_ADMIN_COOKIE required");
const config = JSON.parse(await readFile(values.config, "utf8")) as ServiceClientConfig;
const env = loadEnv();
const { db, close } = createDatabase(env.DATABASE_URL);
try {
  const credentials = await registerServiceClient(
    createAuth({ db, env }),
    new Headers({ cookie: process.env.OIDC_ADMIN_COOKIE }),
    config,
  );
  await writeFile(values.output, JSON.stringify(credentials, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log("クライアントの登録情報を指定ファイルに保存しました");
} finally {
  await close();
}
