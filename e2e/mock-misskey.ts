// E2E 用の Misskey のふり。MiAuth の承認画面を自動承認して callback へ戻す。
import { createServer } from "node:http";

const port = Number(process.env.MOCK_MISSKEY_PORT ?? 3399);
const DEFAULT_USER = { id: "e2e-user-1", username: "e2e", name: "E2E Tester", avatarUrl: null };
// テストから POST /_e2e/user で切り替えられる (管理者など 2 人目のため)
let user = { ...DEFAULT_USER };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/_e2e/user" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      user = body ? { ...DEFAULT_USER, ...JSON.parse(body) } : { ...DEFAULT_USER };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(user));
    });
    return;
  }
  if (url.pathname === "/api/meta") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "2026.1.0", features: { miauth: true } }));
    return;
  }
  const check = url.pathname.match(/^\/api\/miauth\/([^/]+)\/check$/);
  if (check) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, token: "test-token", user }));
    return;
  }
  const approve = url.pathname.match(/^\/miauth\/([^/]+)$/);
  if (approve) {
    const callback = new URL(url.searchParams.get("callback") ?? "/");
    callback.searchParams.set("session", approve[1]!);
    res.writeHead(302, { location: callback.toString() });
    res.end();
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(port, "127.0.0.1", () => {
  console.log(`mock misskey listening on http://127.0.0.1:${port}`);
});
