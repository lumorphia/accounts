// E2E 用の Discord / Google / X のふり (A1.1a)。
// 認可画面はブラウザ側で Playwright が route で受けるので、ここは app のサーバーが叩く
// token と userinfo だけを返す。app は OAUTH_MOCK_BASE_URL でこの先に向き先を差し替える。
// better-auth の各プロバイダーが読むフィールドだけ返す (packages の @better-auth/core/social-providers)
import { createServer, type ServerResponse } from "node:http";

const port = Number(process.env.MOCK_OAUTH_PORT ?? 3401);

/** id は数字列。Discord は avatar 無しのとき BigInt(id) で既定アバターを決めるので、数字でないと落ちる */
type MockUser = { id: string; name: string; email: string; image?: string };
const DEFAULTS: Record<"discord" | "google" | "twitter", MockUser> = {
  discord: { id: "100000000000000001", name: "E2E Discord", email: "discord@test.example.invalid" },
  google: { id: "200000000000000001", name: "E2E Google", email: "google@test.example.invalid" },
  twitter: { id: "300000000000000001", name: "E2E X", email: "x@test.example.invalid" },
};
const users = { ...DEFAULTS };

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** Google の id_token。better-auth の code フローは署名を検証せず decode するだけなので、署名は飾り */
function idToken(u: MockUser): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT", kid: "mock" });
  const payload = b64({
    iss: "https://accounts.google.com",
    aud: "mock-google-id",
    sub: u.id,
    email: u.email,
    email_verified: true,
    name: u.name,
    picture: u.image ?? `http://127.0.0.1:${port}/avatar/${u.id}.png`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.test-signature`;
}

const token = (extra: object = {}) => ({
  access_token: "test-access-token",
  token_type: "Bearer",
  expires_in: 3600,
  scope: "identify email",
  ...extra,
});

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  // fetch は @ を %40 に符号化して送る (users/@me)
  const p = decodeURIComponent(url.pathname);
  if (process.env.MOCK_OAUTH_LOG) console.log(`${req.method} ${req.url}`);

  // テストからの切り替え: POST /_e2e/{discord|google|twitter} { id, name, email?, image? }
  const sw = /^\/_e2e\/(discord|google|twitter)$/.exec(p);
  if (sw && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const key = sw[1] as keyof typeof users;
      const patch = body ? (JSON.parse(body) as Partial<MockUser>) : {};
      users[key] = {
        ...DEFAULTS[key],
        ...patch,
        email: patch.email ?? `${patch.id ?? key}@test.example.invalid`,
      };
      json(res, 200, users[key]);
    });
    return;
  }

  // Discord: https://discord.com/api/oauth2/token, /api/users/@me
  if (p === "/discord/api/oauth2/token") return json(res, 200, token());
  if (p === "/discord/api/users/@me") {
    const u = users.discord;
    return json(res, 200, {
      id: u.id,
      username: u.name.toLowerCase().replace(/\s+/g, "_"),
      global_name: u.name,
      discriminator: "0",
      avatar: null,
      email: u.email,
      verified: true,
    });
  }

  // Google: https://oauth2.googleapis.com/token (id_token を decode して使う)
  if (p === "/google/token") return json(res, 200, token({ id_token: idToken(users.google) }));

  // X: https://api.x.com/2/oauth2/token, /2/users/me?user.fields=...
  if (p === "/x/2/oauth2/token") return json(res, 200, token());
  if (p === "/x/2/users/me") {
    const u = users.twitter;
    const fields = url.searchParams.get("user.fields") ?? "";
    if (fields.includes("confirmed_email"))
      return json(res, 200, { data: { id: u.id, confirmed_email: u.email } });
    return json(res, 200, {
      data: {
        id: u.id,
        name: u.name,
        username: u.name.toLowerCase().replace(/\s+/g, "_"),
        profile_image_url: u.image ?? `http://127.0.0.1:${port}/avatar/${u.id}.png`,
      },
    });
  }

  if (p.startsWith("/avatar/")) {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    return;
  }
  if (p === "/health") return json(res, 200, { ok: true });
  json(res, 404, { error: "not found", path: p });
}).listen(port, "127.0.0.1", () => {
  console.log(`mock oauth listening on http://127.0.0.1:${port}`);
});
