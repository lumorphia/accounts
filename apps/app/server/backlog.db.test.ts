import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, schema, sql } from "@lumorphia-accounts/db";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("operations backlog probe", () => {
  let database: ReturnType<typeof createDatabase>;
  beforeAll(() => {
    database = createDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });
  it("does not report stopped character synchronization for a withdrawn account", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [user] = await database.db
      .insert(schema.users)
      .values({
        name: "Test",
        email: `test-${suffix}@example.invalid`,
        handle: `test_${suffix}`,
        status: "deleted",
        deletedAt: new Date(),
      })
      .returning();
    await database.db.insert(schema.characters).values({
      userId: user!.id,
      lodestoneId: `${Math.floor(Math.random() * 90_000_000) + 10_000_000}`,
      name: "Test",
      world: "Test",
      dataCenter: "Test",
      verifiedAt: new Date(Date.now() - 10 * 86_400_000),
    });
    const statements = (
      await readFile(new URL("../../../docker/monitor/backlog.sql", import.meta.url), "utf8")
    ).split("\n");
    const result = await database.db.execute(
      sql.raw(statements.find((line) => line.includes("'characters='"))!),
    );
    expect(Object.values(result.rows[0]!)).toEqual(["characters=0"]);
  });
});
