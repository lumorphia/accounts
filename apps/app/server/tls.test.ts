import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devTlsOptions } from "./tls.ts";

describe("devTlsOptions", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "accounts-tls-"));
    await writeFile(join(dir, "cert.pem"), "test-cert");
    await writeFile(join(dir, "key.pem"), "test-key");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const paths = () => ({ DEV_TLS_CERT: join(dir, "cert.pem"), DEV_TLS_KEY: join(dir, "key.pem") });

  it("reads the certificate and key in development", () => {
    expect(devTlsOptions({ NODE_ENV: "development", ...paths() })).toEqual({
      cert: Buffer.from("test-cert"),
      key: Buffer.from("test-key"),
    });
  });

  it("reads them in test so E2E runs over https", () => {
    expect(devTlsOptions({ NODE_ENV: "test", ...paths() })).not.toBeNull();
  });

  it("is off in production even when the paths are set (Caddy terminates TLS)", () => {
    expect(devTlsOptions({ NODE_ENV: "production", ...paths() })).toBeNull();
  });

  it("is off when the paths are not set", () => {
    expect(devTlsOptions({ NODE_ENV: "development" })).toBeNull();
  });
});
