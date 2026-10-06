import { describe, expect, it } from "vitest";
import {
  displayNameFromProfile,
  resolveAccountProfile,
  withAccountProfile,
  type ProfileProvider,
} from "./account-display-name.ts";

describe("displayNameFromProfile", () => {
  it("Discord は username、無ければ表示名", () => {
    expect(
      displayNameFromProfile("discord", {
        user: { name: "Alice" },
        data: { username: "alice_ff14", global_name: "Alice" },
      }),
    ).toBe("alice_ff14");
    expect(displayNameFromProfile("discord", { user: { name: "Alice" }, data: {} })).toBe("Alice");
  });

  it("Google はメール、無ければ名前", () => {
    expect(
      displayNameFromProfile("google", { user: { name: "Alice", email: "alice@example.com" } }),
    ).toBe("alice@example.com");
    expect(displayNameFromProfile("google", { user: { name: "Alice", email: null } })).toBe(
      "Alice",
    );
  });

  it("対象外のプロバイダーは null", () => {
    expect(displayNameFromProfile("misskey", { user: { name: "x" } })).toBeNull();
  });
});

describe("resolveAccountProfile", () => {
  const discord: ProfileProvider = {
    id: "discord",
    getUserInfo: async (tokens) =>
      tokens.accessToken === "ok"
        ? {
            user: { name: "Alice", image: "https://cdn.discordapp.com/avatars/1/a.png" },
            data: { username: "alice_ff14" },
          }
        : null,
  };
  const broken: ProfileProvider = {
    id: "google",
    getUserInfo: async () => {
      throw new Error("network");
    },
  };
  const none = { displayName: null, imageUrl: null };

  it("プロバイダーの getUserInfo にトークンを渡して名前とアイコン URL を取る", async () => {
    await expect(
      resolveAccountProfile({ providerId: "discord", accessToken: "ok" }, [discord]),
    ).resolves.toEqual({
      displayName: "alice_ff14",
      imageUrl: "https://cdn.discordapp.com/avatars/1/a.png",
    });
  });

  it("トークン無し・未知のプロバイダー・取得失敗・例外は null", async () => {
    await expect(resolveAccountProfile({ providerId: "discord" }, [discord])).resolves.toEqual(
      none,
    );
    await expect(
      resolveAccountProfile({ providerId: "misskey", accessToken: "ok" }, [discord]),
    ).resolves.toEqual(none);
    await expect(
      resolveAccountProfile({ providerId: "discord", accessToken: "expired" }, [discord]),
    ).resolves.toEqual(none);
    await expect(
      resolveAccountProfile({ providerId: "google", idToken: "x" }, [broken]),
    ).resolves.toEqual(none);
  });
});

describe("withAccountProfile", () => {
  it("取れた項目だけ上書きし、null の項目は元の値を残す", () => {
    const account = { providerId: "discord", displayName: "old", imageUrl: "https://old" };
    expect(withAccountProfile(account, { displayName: "new", imageUrl: null })).toEqual({
      providerId: "discord",
      displayName: "new",
      imageUrl: "https://old",
    });
  });
});
