import * as z from "zod";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Database } from "@lumorphia-accounts/db";
import { eq, schema } from "@lumorphia-accounts/db";

const handleInput = z.string().regex(/^[a-z][a-z0-9_]{2,19}$/);

/** 開発・テスト専用。同じ handle なら同じ利用者に入る。 */
export function devLogin({ db }: { db: Database }) {
  return {
    id: "dev-login",
    endpoints: {
      devLogin: createAuthEndpoint(
        "/dev/login",
        {
          method: "POST",
          body: z.object({
            handle: handleInput,
            name: z.string().min(1).max(50).optional(),
            onboarded: z.boolean().default(true),
          }),
        },
        async (ctx) => {
          const { handle, onboarded } = ctx.body;
          const accountKey = { providerId: "dev", accountId: handle };
          const owner = await ctx.context.internalAdapter.findAccountOwnerByKey(accountKey);
          let user = owner?.kind === "owned" ? owner.user : null;
          if (!user) {
            user = await ctx.context.internalAdapter.createUser(
              {
                name: ctx.body.name ?? handle,
                email: `${handle}@dev.lumorphia.invalid`,
                emailVerified: false,
                image: null,
              },
              { method: "dev" },
            );
            await ctx.context.internalAdapter.linkAccount({ ...accountKey, userId: user.id });
            if (onboarded) {
              try {
                await db
                  .update(schema.users)
                  .set({ handle, status: "active", handleChangedAt: new Date() })
                  .where(eq(schema.users.id, user.id));
              } catch {
                throw APIError.from("CONFLICT", {
                  code: "handle_taken",
                  message: "handle is already used",
                });
              }
            }
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true, userId: user.id });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
