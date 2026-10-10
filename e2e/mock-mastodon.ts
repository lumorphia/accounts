// E2E 用の Mastodon のふり (#55)。クライアント登録、承認画面 (自動承認して callback へ)、token、verify_credentials。
import { createServer, type ServerResponse } from "node:http";

const port = Number(process.env.MOCK_MASTODON_PORT ?? 3402);
const DEFAULT_USER = {
  id: "e2e-mastodon-1",
  username: "e2e_md",
  acct: "e2e_md",
  display_name: "E2E Mastodon",
  avatar: null,
};
// テストから POST /_e2e/user で切り替えられる
let user = { ...DEFAULT_USER };
const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") return json(res, { ok: true });
  if (url.pathname === "/_e2e/user" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      user = body ? { ...DEFAULT_USER, ...JSON.parse(body) } : { ...DEFAULT_USER };
      json(res, user);
    });
    return;
  }
  if (url.pathname === "/api/v1/apps" && req.method === "POST") {
    json(res, { id: "1", client_id: "test-client", client_secret: "test-secret" });
    return;
  }
  if (url.pathname === "/oauth/authorize") {
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "/");
    callback.searchParams.set("code", "e2e-code");
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: callback.toString() });
    res.end();
    return;
  }
  if (url.pathname === "/oauth/token" && req.method === "POST") {
    json(res, { access_token: "test-token", token_type: "Bearer", scope: "read:accounts" });
    return;
  }
  if (url.pathname === "/api/v1/accounts/verify_credentials") {
    json(res, { ...user, url: `http://127.0.0.1:${port}/@${user.username}` });
    return;
  }
  if (url.pathname === "/oauth/revoke" && req.method === "POST") {
    json(res, {});
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(port, "127.0.0.1", () => {
  console.log(`mock mastodon listening on http://127.0.0.1:${port}`);
});
