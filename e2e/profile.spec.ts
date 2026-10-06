import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("an active user updates their name and avatar while the handle is locked", async ({
  page,
}) => {
  const handle = `p_${Date.now().toString(36)}`;
  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");

  const profile = await page.evaluate(async () => {
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    return { status: res.status, body: await res.json() };
  });
  expect(profile.status).toBe(200);
  expect(profile.body.profile.name).toBe("New Name");

  const locked = await page.evaluate(async () => {
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "another_handle" }),
    });
    return res.status;
  });
  expect(locked).toBe(409);

  const image = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const res = await fetch("/api/me/avatar", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: bytes,
    });
    return { status: res.status, body: await res.json() };
  }, tinyPng);
  expect(image.status).toBe(200);
  expect(image.body.image).toContain(`/avatars/`);
  const served = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, mime: res.headers.get("content-type") };
  }, image.body.image);
  expect(served).toEqual({ status: 200, mime: "image/webp" });
  const me = await page.evaluate(async () => (await fetch("/api/me")).json());
  expect(me.user.image).toBe(image.body.image);

  const removed = await page.evaluate(
    async () => (await fetch("/api/me/avatar", { method: "DELETE" })).status,
  );
  expect(removed).toBe(204);
  const after = await page.evaluate(async () => (await fetch("/api/me")).json());
  expect(after.user.image).toBeNull();
});
