import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@lumorphia-accounts/db";
import { PostgresLodestonePacer } from "./pacing.ts";
import { HttpLodestoneSource } from "./http.ts";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("shared Lodestone pacing (PostgreSQL)", () => {
  let first: ReturnType<typeof createDatabase>;
  let second: ReturnType<typeof createDatabase>;
  beforeAll(() => {
    first = createDatabase(databaseUrl!);
    second = createDatabase(databaseUrl!);
  });
  afterAll(async () => {
    await first?.close();
    await second?.close();
  });
  it("serializes independent sources through body consumption and leaves a gap", async () => {
    let active = 0;
    let maximum = 0;
    let starts: number[] = [];
    let finishes: number[] = [];
    const fetchFn = async () => {
      active++;
      maximum = Math.max(maximum, active);
      starts = [...starts, performance.now()];
      return new Response(
        new ReadableStream({
          async start(controller) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            active--;
            finishes = [...finishes, performance.now()];
            controller.enqueue(
              new TextEncoder().encode('<html><div class="parts__zero">該当なし</div></html>'),
            );
            controller.close();
          },
        }),
      );
    };
    const sources = [first, second].map(
      ({ db }) =>
        new HttpLodestoneSource({
          fetch: fetchFn,
          minIntervalMs: 0,
          pacer: new PostgresLodestonePacer(db, 60),
        }),
    );
    await Promise.all(sources.map((source) => source.searchCharacter("Hal Myth", "Tiamat")));
    expect(maximum).toBe(1);
    expect(starts[1]! - finishes[0]!).toBeGreaterThanOrEqual(55);
  });
  it("commits failed request pacing before another process can run", async () => {
    const a = new PostgresLodestonePacer(first.db, 60);
    const b = new PostgresLodestonePacer(second.db, 60);
    let failedAt = 0;
    await expect(
      a.run(async () => {
        failedAt = performance.now();
        throw new Error("test-network-failure");
      }),
    ).rejects.toThrow("test-network-failure");
    // 取得の失敗時点から次の取得開始までを測る。
    // commit と assertion の時間を、必要な間隔から差し引かない。
    await b.run(async () => {
      expect(performance.now() - failedAt).toBeGreaterThanOrEqual(55);
      return "ok";
    });
  });
});
