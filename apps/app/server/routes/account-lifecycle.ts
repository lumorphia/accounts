import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  deleteLumorphiaAccount,
  deleteServiceAccount,
  listServices,
  restoreLumorphiaAccount,
  restoreServiceAccount,
  SERVICES,
} from "@lumorphia-accounts/core";
import { DomainError } from "../plugins/errors.ts";
import { withErrors } from "../schemas/error.ts";
const serviceSchema = z.object({
  service: z.string(),
  state: z.enum(["active", "deleted", "purged"]),
  revision: z.number().int(),
  deletedAt: z.string().nullable(),
  recoverUntil: z.string().nullable(),
});
const confirm = z.object({ confirm: z.string().min(3).max(20) }).strict();
const ok = z.object({ ok: z.literal(true) });
const params = z.object({ service: z.enum(SERVICES) });
export const accountLifecycleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/me/")) reply.header("cache-control", "no-store");
  });
  const enabled = () => {
    if (!app.env.FEATURE_ACCOUNT_LIFECYCLE)
      throw new DomainError("forbidden", "account_lifecycle_disabled");
  };
  app.get(
    "/me/lifecycle",
    {
      preValidation: [app.requireAuth],
      schema: {
        response: withErrors({
          200: z.object({
            enabled: z.boolean(),
            canDelete: z.boolean(),
            recoveryDays: z.literal(30),
            services: z.array(serviceSchema),
          }),
        }),
      },
    },
    async (req) => ({
      enabled: app.env.FEATURE_ACCOUNT_LIFECYCLE,
      canDelete: req.user!.role !== "admin",
      recoveryDays: 30 as const,
      services: await listServices({ db: app.db }, req.user!.id),
    }),
  );
  app.post(
    "/me/deletion",
    {
      preValidation: [app.requireAuth],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { body: confirm, response: withErrors({ 200: ok }) },
    },
    async (req) => {
      enabled();
      await deleteLumorphiaAccount({ db: app.db }, req.user!.id, req.body.confirm);
      return { ok: true as const };
    },
  );
  // 退会中の本人だけが呼ぶので requireSession (退会済みを弾く) は使わない。
  // 既に退会した利用者の復旧は FEATURE_ACCOUNT_LIFECYCLE を無効にしても止めない (ADR-0008)。
  app.post(
    "/me/restore",
    {
      preValidation: [app.optionalAuth],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { response: withErrors({ 200: ok }) },
    },
    async (req) => {
      if (!req.user) throw new DomainError("unauthorized", "login required");
      await restoreLumorphiaAccount({ db: app.db }, req.user.id);
      return { ok: true as const };
    },
  );
  app.post(
    "/me/services/:service/deletion",
    {
      preValidation: [app.requireAuth],
      schema: { params, body: confirm, response: withErrors({ 200: ok }) },
    },
    async (req) => {
      enabled();
      await deleteServiceAccount(
        { db: app.db },
        req.user!.id,
        req.params.service,
        req.body.confirm,
      );
      return { ok: true as const };
    },
  );
  app.post(
    "/me/services/:service/restore",
    { preValidation: [app.requireAuth], schema: { params, response: withErrors({ 200: ok }) } },
    async (req) => {
      await restoreServiceAccount({ db: app.db }, req.user!.id, req.params.service);
      return { ok: true as const };
    },
  );
};
