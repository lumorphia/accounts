import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fastify, type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { DomainError, errorsPlugin } from "./errors.ts";

let app: FastifyInstance;
const captureException = vi.fn();

beforeAll(async () => {
  app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorsPlugin, { captureException });

  app.post(
    "/echo",
    { schema: { body: z.object({ n: z.number().int().min(1) }) } },
    async (req) => req.body,
  );
  app.get("/domain/:code", async (req) => {
    const { code } = req.params as { code: DomainError["code"] };
    throw new DomainError(code, `boom ${code}`);
  });
  app.get("/too-many", async () => {
    const err = new Error("slow down") as Error & { statusCode: number };
    err.statusCode = 429;
    throw err;
  });
  app.get("/teapot", async () => {
    const err = new Error("short and stout") as Error & { statusCode: number };
    err.statusCode = 418;
    throw err;
  });
  app.get("/crash", async () => {
    throw new Error("secret internals");
  });
  await app.ready();
});

beforeEach(() => captureException.mockClear());

afterAll(async () => {
  await app.close();
});

describe("errorsPlugin", () => {
  it("maps zod validation failures to 400 with issues", async () => {
    const res = await app.inject({ method: "POST", url: "/echo", payload: { n: 0 } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.issues[0].path).toContain("n");
  });

  it.each([
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["upstream_unavailable", 503],
  ])("maps DomainError %s to %i", async (code, status) => {
    const res = await app.inject({ method: "GET", url: `/domain/${code}` });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code, message: `boom ${code}` } });
  });

  it("maps statusCode 429 to rate_limited", async () => {
    const res = await app.inject({ method: "GET", url: "/too-many" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("rate_limited");
  });

  it("passes other 4xx through with their message", async () => {
    const res = await app.inject({ method: "GET", url: "/teapot" });
    expect(res.statusCode).toBe(418);
    expect(res.json().error.message).toBe("short and stout");
  });

  it("hides internals on 500", async () => {
    const res = await app.inject({ method: "GET", url: "/crash" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "internal", message: "internal error" } });
  });

  it("reports an unexpected 500 without request contents", async () => {
    const res = await app.inject({ method: "GET", url: "/crash?secret=hidden" });

    expect(res.statusCode).toBe(500);
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      method: "GET",
      requestId: expect.any(String),
      route: "/crash",
      runtime: "server",
    });
    expect(JSON.stringify(captureException.mock.calls)).not.toContain("hidden");
  });

  it("does not report expected domain errors", async () => {
    await app.inject({ method: "GET", url: "/domain/upstream_unavailable" });

    expect(captureException).not.toHaveBeenCalled();
  });
});
