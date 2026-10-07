import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDatabase } from "@lumorphia-accounts/db";
import { createAuth } from "../apps/app/server/auth/auth.ts";
import {
  manageLegacyLedger,
  type LegacyAdminAction,
} from "../apps/app/server/legacy-ledger-admin.ts";
import { loadEnv } from "../apps/app/server/env.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      release: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (
    !values.input === !values.release ||
    !process.env.LEGACY_ADMIN_COOKIE ||
    (values.release && !values.apply)
  )
    throw new Error("invalid arguments");
  const action: LegacyAdminAction = values.input
    ? {
        kind: "import",
        snapshot: JSON.parse(await readFile(values.input, "utf8")) as unknown,
        apply: values.apply,
      }
    : { kind: "release", legacyUserId: values.release! };
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL);
  try {
    const result = await manageLegacyLedger(
      {
        db: database.db,
        auth: createAuth({ db: database.db, env }),
        headers: new Headers({ cookie: process.env.LEGACY_ADMIN_COOKIE }),
      },
      action,
    );
    // 台帳の識別子や認証情報は出さず、件数と実行結果だけを返す。
    console.log(JSON.stringify({ applied: values.apply, ...result }));
  } finally {
    await database.close();
  }
}
try {
  await main();
} catch {
  console.error(
    "台帳の処理に失敗しました。--input / --release、--apply、入力形式・予約の衝突・現在の LEGACY_ADMIN_COOKIE を確認してください。",
  );
  process.exitCode = 1;
}
