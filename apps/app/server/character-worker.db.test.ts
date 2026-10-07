import { describe, expect, it } from "vitest";
import { createCharacterWorker } from "./character-worker.ts";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("character worker application", () => {
  it("starts and closes the application with fetching disabled", async () => {
    const worker = await createCharacterWorker({
      DATABASE_URL: url,
      FEATURE_LODESTONE: "0",
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    });
    await expect(worker.close()).resolves.toBeUndefined();
  });
});
