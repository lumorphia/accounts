import { describe, expect, it } from "vitest";
import { createDatabase } from "./client.ts";
import { pingDatabase } from "./ping.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("pingDatabase", () => {
  it("resolves when the database answers", async () => {
    const { db, close } = createDatabase(url!);
    try {
      await expect(pingDatabase(db)).resolves.toBeUndefined();
    } finally {
      await close();
    }
  });

  it("rejects when the database is unreachable", async () => {
    const { db, close } = createDatabase("postgres://nobody:nothing@127.0.0.1:1/none");
    try {
      await expect(pingDatabase(db)).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
