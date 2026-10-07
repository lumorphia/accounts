import { createHash, randomBytes } from "node:crypto";
import { eq, schema, type Database } from "@lumorphia-accounts/db";
import { AVATAR_SIZES, renderAvatar } from "@lumorphia/media";
import type { ObjectStorage } from "@lumorphia/storage";
import { DomainError } from "./errors.ts";

export type AvatarDeps = { db: Database; storage: ObjectStorage; imageBaseUrl: string };
const keyBase = (userId: string, hash: string) => `avatars/${userId}/${hash}`;
const key = (base: string, size: number) => `${base}/${size}.webp`;
export const avatarUrl = (baseUrl: string, base: string) =>
  `${baseUrl.replace(/\/$/, "")}/${key(base, AVATAR_SIZES[0])}`;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function activeUser(tx: Transaction, userId: string) {
  const [user] = await tx
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for("update");
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
  const variants = await renderAvatar(bytes, mime);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const result = await deps.db.transaction(async (tx) => {
    // 退会と同じロックで、画像の保存と削除対象の確定を順序づける。
    const user = await activeUser(tx, userId);
    const originalBase = keyBase(userId, hash);
    const retired = await tx.query.assetDeletions.findFirst({
      where: eq(schema.assetDeletions.keyBase, originalBase),
      columns: { id: true },
    });
    const base = retired ? keyBase(userId, randomBytes(8).toString("hex")) : originalBase;
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
    await tx
      .update(schema.users)
      .set({ image, avatarKeyBase: base })
      .where(eq(schema.users.id, userId));
    const oldBase = user.avatarKeyBase !== base ? user.avatarKeyBase : null;
    if (oldBase)
      await tx
        .insert(schema.assetDeletions)
        .values({ sub: userId, keyBase: oldBase })
        .onConflictDoNothing();
    return { image, oldBase };
  });
  if (result.oldBase)
    await deps.storage.delete(AVATAR_SIZES.map((size) => key(result.oldBase!, size)));
  return { image: result.image };
}

export async function removeUploadedAvatar(deps: AvatarDeps, userId: string): Promise<void> {
  const base = await deps.db.transaction(async (tx) => {
    const user = await activeUser(tx, userId);
    if (user.avatarKeyBase)
      await tx
        .insert(schema.assetDeletions)
        .values({ sub: userId, keyBase: user.avatarKeyBase })
        .onConflictDoNothing();
    await tx
      .update(schema.users)
      .set({ image: null, avatarKeyBase: null })
      .where(eq(schema.users.id, userId));
    return user.avatarKeyBase;
  });
  if (base) await deps.storage.delete(AVATAR_SIZES.map((size) => key(base, size)));
}
