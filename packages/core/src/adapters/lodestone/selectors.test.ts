import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCharacterPage, parseSearchPage } from "./selectors.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/lodestone/${name}`, import.meta.url), "utf8");

describe("parseCharacterPage", () => {
  it("reads the owner's character profile", () => {
    const character = parseCharacterPage(fixture("character-15022394.html"), "15022394");
    expect(character).toMatchObject({
      lodestoneId: "15022394",
      name: "Hal Myth",
      world: "Tiamat",
      dataCenter: "Gaia",
      race: "miqote",
      rawRace: "ミコッテ",
      clan: "ムーンキーパー",
      gender: "female",
    });
    expect(character.avatarUrl).toMatch(/^https:\/\/img2\.finalfantasyxiv\.com\//);
    expect(character.portraitUrl).toMatch(/^https:\/\/img2\.finalfantasyxiv\.com\//);
  });
  it("reads the Lumorphia verification token from the introduction", () => {
    expect(
      parseCharacterPage(fixture("character-15022394-with-token.html"), "15022394")
        .selfIntroduction,
    ).toContain("lumorphia-a1b2c3d4");
  });
  it("reports a missing character in an HTTP 200 error page", () => {
    expect(() => parseCharacterPage(fixture("character-404.html"), "1")).toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
  });
  it("reports a changed page structure", () => {
    expect(() => parseCharacterPage(fixture("character-15022394-broken.html"), "15022394")).toThrow(
      expect.objectContaining({ code: "parse_error" }),
    );
  });
  it("rejects an invalid world format", () => {
    expect(() =>
      parseCharacterPage(
        fixture("character-15022394.html").replace(/Tiamat\s+\[Gaia\]/, "Tiamat"),
        "15022394",
      ),
    ).toThrow(expect.objectContaining({ code: "parse_error" }));
  });
  it("keeps an unknown race as raw text", () => {
    expect(
      parseCharacterPage(
        fixture("character-15022394.html").replaceAll("ミコッテ", "未知の種族"),
        "15022394",
      ),
    ).toMatchObject({ race: null, rawRace: "未知の種族" });
  });
  it("accepts an empty introduction", () => {
    const html = fixture("character-15022394.html").replaceAll(
      "character__selfintroduction",
      "test-removed-introduction",
    );
    expect(parseCharacterPage(html, "15022394").selfIntroduction).toBe("");
  });
});

describe("parseSearchPage", () => {
  it("reads search results without sidebar rankings", () => {
    expect(parseSearchPage(fixture("search-hal-myth-tiamat.html"))).toEqual([
      { lodestoneId: "15022394", name: "Hal Myth", world: "Tiamat", dataCenter: "Gaia" },
    ]);
  });
  it("returns an empty list for no matches", () => {
    expect(parseSearchPage(fixture("search-empty.html"))).toEqual([]);
  });
  it("reports a changed search structure", () => {
    expect(() => parseSearchPage("<html></html>")).toThrow(
      expect.objectContaining({ code: "parse_error" }),
    );
  });
});
