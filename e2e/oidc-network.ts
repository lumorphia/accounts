/**
 * E2E の発行元プロセスだけで preload する。
 * 既知の JWKS と back-channel の通信を手元の TLS サーバーへ向ける。
 * 登録先の URL 検査と、手元 CA による証明書の検証はそのまま使う。
 */
import { readFileSync } from "node:fs";
import { request } from "node:https";

const issuer = process.env.AUTH_BASE_URL;
if (!issuer || process.env.NODE_ENV !== "test") throw new Error("OIDC network preload is E2E only");
const ca = readFileSync(new URL("../.data/tls/ca.pem", import.meta.url));
const callbackPort = process.env.MOCK_OIDC_PORT ?? "3403";
const targets = new Map([
  [`${issuer}/api/auth/jwks`, `${issuer}/api/auth/jwks`],
  [
    "https://prismtone.lumorphia.com/api/lumorphia/backchannel-logout",
    `https://prismtone.lumorphia.test:${callbackPort}/api/lumorphia/backchannel-logout`,
  ],
]);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const source = input instanceof Request ? input.url : String(input);
  const target = targets.get(source);
  if (!target) return nativeFetch(input, init);
  const outgoing = new Request(target, input instanceof Request ? new Request(input, init) : init);
  const body =
    outgoing.method === "GET" || outgoing.method === "HEAD"
      ? undefined
      : Buffer.from(await outgoing.arrayBuffer());
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      target,
      {
        method: outgoing.method,
        headers: Object.fromEntries(outgoing.headers),
        ca,
        signal: outgoing.signal,
        // TLS の servername は *.lumorphia.test のままにして、DNS だけ 127.0.0.1 に向ける。
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
          else callback(null, "127.0.0.1", 4);
        },
      },
      (res) => {
        let chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks = [...chunks, chunk];
        });
        res.on("error", reject);
        res.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const status = res.statusCode ?? 500;
          resolve(new Response(status === 204 ? null : Buffer.concat(chunks), { status, headers }));
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}) satisfies typeof fetch;
