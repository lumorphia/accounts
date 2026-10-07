import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { eq, schema } from "@lumorphia-accounts/db";
import { AVATAR_MAX_INPUT_BYTES, ImageRejectedError } from "@lumorphia/media";
import {
  HANDLE_MAX_LENGTH,
  NAME_MAX_LENGTH,
  completeOnboarding,
  getProfile,
  handleAvailability,
  listLinkedAccounts,
  removeUploadedAvatar,
  setUploadedAvatar,
  unlinkAccount,
  updateProfile,
} from "@lumorphia-accounts/core";
import { readRemoteAvatar } from "../auth/remote-avatar.ts";
import { refreshLinkedAccountProfiles } from "../auth/refresh-account-profiles.ts";
import { DomainError } from "../plugins/errors.ts";
import { withErrors } from "../schemas/error.ts";
import { TERMS_VERSION, PRIVACY_VERSION } from "@lumorphia-accounts/core/domain/legal-consent";

const meSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  image: z.string().nullable(),
  role: z.enum(["user", "admin"]),
  status: z.enum(["pending", "active", "suspended", "deleted"]),
  nextHandleChangeAt: z.string().nullable(),
});
const profileSchema = z.object({
  handle: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  nextHandleChangeAt: z.string().nullable(),
});
const accountSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  label: z.string(),
  displayName: z.string().nullable(),
  imageUrl: z.string().nullable(),
  createdAt: z.string(),
});
const handleInput = z.string().min(1).max(HANDLE_MAX_LENGTH);
const nameInput = z
  .string()
  .min(1)
  .max(NAME_MAX_LENGTH * 2);

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/legal",
    {
      schema: {
        response: { 200: z.object({ termsVersion: z.string(), privacyVersion: z.string() }) },
      },
    },
    async () => ({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }),
  );
  app.get(
    "/me",
    {
      schema: {
        tags: ["auth"],
        summary: "ログイン中の利用者",
        response: withErrors({ 200: z.object({ user: meSchema.nullable() }) }),
      },
      preValidation: [app.optionalAuth],
    },
    async (req) => ({
      user: req.user
        ? {
            id: req.user.id,
            name: req.user.name,
            handle: req.user.handle ?? "",
            image: req.user.image ?? null,
            role: req.user.role === "admin" ? ("admin" as const) : ("user" as const),
            status: req.user.status as "pending" | "active" | "suspended" | "deleted",
            nextHandleChangeAt: req.user.handleChangedAt
              ? new Date(
                  new Date(req.user.handleChangedAt).getTime() + 30 * 86_400_000,
                ).toISOString()
              : null,
          }
        : null,
    }),
  );

  app.get(
    "/me/handle-availability",
    {
      schema: {
        querystring: z.object({ handle: handleInput }),
        response: withErrors({
          200: z.object({
            available: z.boolean(),
            reason: z.enum(["invalid", "reserved", "taken"]).nullable(),
          }),
        }),
      },
      preValidation: [app.requireSession],
    },
    async (req) => handleAvailability(app.db, req.query.handle, req.user!.id),
  );

  app.post(
    "/me/onboarding",
    {
      schema: {
        body: z.object({
          handle: handleInput,
          name: nameInput,
          consent: z.object({
            termsVersion: z.string(),
            privacyVersion: z.string(),
            ageConfirmed: z.literal(true),
          }),
        }),
        response: withErrors({ 200: z.object({ profile: profileSchema }) }),
      },
      preValidation: [app.requireSession],
    },
    async (req) => {
      await completeOnboarding(app.db, req.user!.id, req.body);
      return { profile: await getProfile(app.db, req.user!.id) };
    },
  );

  app.patch(
    "/me/profile",
    {
      schema: {
        body: z.object({ handle: handleInput, name: nameInput }).partial(),
        response: withErrors({ 200: z.object({ profile: profileSchema }) }),
      },
      preValidation: [app.requireAuth],
    },
    async (req) => ({ profile: await updateProfile(app.db, req.user!.id, req.body) }),
  );

  app.get(
    "/me/accounts",
    {
      schema: { response: withErrors({ 200: z.object({ accounts: z.array(accountSchema) }) }) },
      preValidation: [app.requireSession],
    },
    async (req) => ({ accounts: await listLinkedAccounts(app.db, req.user!.id) }),
  );

  app.post(
    "/me/accounts/refresh",
    {
      schema: { response: withErrors({ 200: z.object({ accounts: z.array(accountSchema) }) }) },
      preValidation: [app.requireAuth],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      await refreshLinkedAccountProfiles({
        db: app.db,
        auth: app.auth,
        userId: req.user!.id,
        headers: req.headers,
        log: req.log,
      });
      return { accounts: await listLinkedAccounts(app.db, req.user!.id) };
    },
  );

  app.delete(
    "/me/accounts/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: withErrors({ 200: z.object({ ok: z.literal(true) }) }),
      },
      preValidation: [app.requireAuth],
    },
    async (req) => {
      await unlinkAccount(app.db, req.user!.id, req.params.id);
      return { ok: true as const };
    },
  );

  const avatarDeps = () => ({
    db: app.db,
    storage: app.storage,
    imageBaseUrl: app.env.PUBLIC_IMAGE_BASE_URL,
  });
  const mimes = ["image/png", "image/jpeg", "image/webp"];
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      mimes,
      { parseAs: "buffer", bodyLimit: AVATAR_MAX_INPUT_BYTES },
      (_req, body, done) => done(null, body),
    );
    scope.put(
      "/me/avatar",
      {
        schema: { response: withErrors({ 200: z.object({ image: z.string() }) }) },
        preValidation: [app.requireAuth],
        config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
      },
      async (req) => {
        const mime = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
        if (!mimes.includes(mime) || !Buffer.isBuffer(req.body))
          throw new DomainError("validation", "unsupported content type");
        try {
          return await setUploadedAvatar(
            avatarDeps(),
            req.user!.id,
            new Uint8Array(req.body),
            mime,
          );
        } catch (error) {
          if (error instanceof ImageRejectedError)
            throw new DomainError("validation", error.reason);
          throw error;
        }
      },
    );
  });

  app.post(
    "/me/avatar/from-account",
    {
      schema: {
        body: z.object({ accountId: z.string().uuid() }),
        response: withErrors({ 200: z.object({ image: z.string() }) }),
      },
      preValidation: [app.requireAuth],
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (req) => {
      const account = await app.db.query.accounts.findFirst({
        columns: { userId: true, imageUrl: true },
        where: eq(schema.accounts.id, req.body.accountId),
      });
      if (!account || account.userId !== req.user!.id)
        throw new DomainError("not_found", "account not found");
      if (!account.imageUrl) throw new DomainError("validation", "account has no image");
      const { bytes, mime } = await readRemoteAvatar(account.imageUrl);
      try {
        return await setUploadedAvatar(avatarDeps(), req.user!.id, bytes, mime);
      } catch (error) {
        if (error instanceof ImageRejectedError) throw new DomainError("validation", error.reason);
        throw error;
      }
    },
  );

  app.delete(
    "/me/avatar",
    { schema: { response: withErrors({ 204: z.null() }) }, preValidation: [app.requireAuth] },
    async (req, reply) => {
      await removeUploadedAvatar(avatarDeps(), req.user!.id);
      return reply.code(204).send(null);
    },
  );
};
