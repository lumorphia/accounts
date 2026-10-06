import { createHash } from "node:crypto";
import { eq, schema, type Database } from "@lumorphia-accounts/db";
import { AVATAR_SIZES, renderAvatar } from "@lumorphia/media";
import type { ObjectStorage } from "@lumorphia/storage";
import { DomainError } from "./errors.ts";

export type AvatarDeps = { db: Database; storage: ObjectStorage; imageBaseUrl: string };
const keyBase = (userId: string, hash: string) => `avatars/${userId}/${hash}`;
const key = (base: string, size: number) => `${base}/${size}.webp`;
export const avatarUrl = (baseUrl: string, base: string) =>
  `${baseUrl.replace(/\/$/, "")}/${key(base, AVATAR_SIZES[0])}`;

async function activeUser(db: Database, userId: string) {
  const user = await db.query.users.findFirst({
    columns: { status: true, avatarKeyBase: true },
    where: eq(schema.users.id, userId),
  });
  if (!user) throw new DomainError("not_found", "user not found");
  if (user.status !== "active") throw new DomainError("forbidden", "account not active");
  return user;
}

export async function setUploadedAvatar(
  deps: AvatarDeps,
  userId: string,
  bytes: Uint8Array,
  mime: string,
) {
  const user = await activeUser(deps.db, userId);
  const variants = await renderAvatar(bytes, mime);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const base = keyBase(userId, hash);
  if (base !== user.avatarKeyBase) {
    await Promise.all(
      AVATAR_SIZES.map((size) =>
        deps.storage.put({
          key: key(base, size),
          body: variants[size],
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable",
        }),
      ),
    );
  }
  const image = avatarUrl(deps.imageBaseUrl, base);
  await deps.db
    .update(schema.users)
    .set({ image, avatarKeyBase: base })
    .where(eq(schema.users.id, userId));
  if (user.avatarKeyBase && user.avatarKeyBase !== base)
    await deps.storage.delete(AVATAR_SIZES.map((size) => key(user.avatarKeyBase!, size)));
  return { image };
}

export async function removeUploadedAvatar(deps: AvatarDeps, userId: string): Promise<void> {
  const user = await activeUser(deps.db, userId);
  await deps.db
    .update(schema.users)
    .set({ image: null, avatarKeyBase: null })
    .where(eq(schema.users.id, userId));
  if (user.avatarKeyBase)
    await deps.storage.delete(AVATAR_SIZES.map((size) => key(user.avatarKeyBase!, size)));
}
