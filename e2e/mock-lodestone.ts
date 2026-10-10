/** 運営者の fixture を使う。実際の Lodestone へ接続しない。 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const port = Number(process.env.MOCK_LODESTONE_PORT ?? 3404);
const fixture = (name: string) =>
  readFileSync(
    new URL(`../packages/core/src/adapters/fixtures/lodestone/${name}`, import.meta.url),
    "utf8",
  );
let introduction = "";
createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    res.end("ok");
    return;
  }
  if (url.pathname === "/_e2e/character" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      const data = JSON.parse(body) as { introduction?: string };
      introduction = data.introduction ?? "";
      res.writeHead(204);
      res.end();
    });
    return;
  }
  if (url.pathname === "/lodestone/character/") {
    res.setHeader("content-type", "text/html");
    res.end(
      fixture(
        url.searchParams.get("q")?.toLowerCase() === "hal myth" &&
          url.searchParams.get("worldname") === "Tiamat"
          ? "search-hal-myth-tiamat.html"
          : "search-empty.html",
      ),
    );
    return;
  }
  if (url.pathname === "/lodestone/character/15022394/") {
    const escaped = introduction
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    res.setHeader("content-type", "text/html");
    res.end(fixture("character-15022394.html").replace("Test introduction", escaped));
    return;
  }
  res.writeHead(404);
  res.end(fixture("character-404.html"));
}).listen(port, "127.0.0.1");
