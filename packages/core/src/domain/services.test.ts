import { describe, expect, it } from "vitest";
import { serviceOfClientMetadata } from "./services.ts";

describe("serviceOfClientMetadata", () => {
  it("reads the service from the registered client metadata", () => {
    expect(serviceOfClientMetadata({ lumorphia_service: "prismtone" })).toBe("prismtone");
  });
  it("reads metadata that is still a JSON string", () => {
    expect(serviceOfClientMetadata('{"lumorphia_service":"scenote"}')).toBe("scenote");
  });
  it("returns null for an unknown service, missing metadata or broken JSON", () => {
    expect(serviceOfClientMetadata({ lumorphia_service: "unknown" })).toBeNull();
    expect(serviceOfClientMetadata(null)).toBeNull();
    expect(serviceOfClientMetadata({})).toBeNull();
    expect(serviceOfClientMetadata("{broken")).toBeNull();
  });
});
