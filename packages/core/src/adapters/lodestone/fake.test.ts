import { describe, expect, it } from "vitest";
import { FakeLodestoneSource, fakeLodestoneCharacter } from "./fake.ts";
import { LodestoneError } from "./types.ts";

describe("FakeLodestoneSource", () => {
  it("reads a configured character", async () => {
    const character = fakeLodestoneCharacter({ lodestoneId: "1" });
    const source = new FakeLodestoneSource([character]);
    await expect(source.fetchCharacter("1")).resolves.toEqual(character);
    expect(source.calls).toEqual([{ method: "fetch", arg: "1" }]);
  });
  it("searches by name and world without case sensitivity in the name", async () => {
    const source = new FakeLodestoneSource([
      fakeLodestoneCharacter({ lodestoneId: "1" }),
      fakeLodestoneCharacter({ lodestoneId: "2", world: "Bahamut" }),
      fakeLodestoneCharacter({ lodestoneId: "3", name: "Test Other" }),
    ]);
    await expect(source.searchCharacter("test character", "Tiamat")).resolves.toEqual([
      { lodestoneId: "1", name: "Test Character", world: "Tiamat", dataCenter: "Gaia" },
    ]);
    expect(source.calls).toEqual([{ method: "search", arg: "test character@Tiamat" }]);
  });
  it("updates the introduction for a verification test", async () => {
    const source = new FakeLodestoneSource();
    source.add(fakeLodestoneCharacter({ lodestoneId: "1" }));
    source.setSelfIntroduction("1", "lumorphia-a1b2c3d4");
    await expect(source.fetchCharacter("1")).resolves.toMatchObject({
      selfIntroduction: "lumorphia-a1b2c3d4",
    });
  });
  it("rejects an introduction update for an unknown character", () => {
    expect(() => new FakeLodestoneSource().setSelfIntroduction("1", "test")).toThrow();
  });
  it("reports an unknown character", async () => {
    await expect(new FakeLodestoneSource().fetchCharacter("1")).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("fails one fetch and then recovers", async () => {
    const source = new FakeLodestoneSource([fakeLodestoneCharacter({ lodestoneId: "1" })]);
    source.failNextWith = new LodestoneError("unavailable");
    await expect(source.fetchCharacter("1")).rejects.toMatchObject({ code: "unavailable" });
    await expect(source.fetchCharacter("1")).resolves.toMatchObject({ lodestoneId: "1" });
  });
  it("fails one search and then recovers", async () => {
    const source = new FakeLodestoneSource();
    source.failNextWith = new LodestoneError("rate_limited", "test-limited");
    await expect(source.searchCharacter("Test Character", "Tiamat")).rejects.toMatchObject({
      code: "rate_limited",
      message: "test-limited",
    });
    await expect(source.searchCharacter("Test Character", "Tiamat")).resolves.toEqual([]);
  });
});
