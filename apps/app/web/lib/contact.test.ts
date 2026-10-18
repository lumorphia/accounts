import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTACT_FORM_URL } from "./contact.ts";

const legal = (name: string) =>
  readFileSync(new URL(`../../../../docs/legal/${name}.md`, import.meta.url), "utf8");

describe("CONTACT_FORM_URL", () => {
  it("opens the shared Google Form with Lumorphia already chosen as the service", () => {
    const url = new URL(CONTACT_FORM_URL);
    expect(url.origin + url.pathname).toMatch(
      /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/,
    );
    expect(url.searchParams.get("usp")).toBe("pp_url");
    expect(url.searchParams.get("entry.2074387887")).toBe("Lumorphia");
  });

  it.each(["terms", "privacy"])("is the form the %s links to", (name) => {
    const links = [...legal(name).matchAll(/\((https:\/\/[^)]*(?:forms\.gle|\/forms\/)[^)]*)\)/g)];
    expect(links.length).toBeGreaterThan(0);
    expect(links.map((m) => m[1])).toEqual(links.map(() => CONTACT_FORM_URL));
  });
});
