// A0 spike: Better Auth の oauth-provider を Lumorphia の発行元 (IdP) に、
// generic-oauth をサービス (RP) にして、ログインが通るかを確かめる。
// ブラウザの代わりに、オリジンごとに Cookie を持つ fetch でリダイレクトを 1 つずつたどる。
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import dns from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { jwt } from "better-auth/plugins/jwt";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { createLocalJWKSet, jwtVerify, decodeJwt } from "jose";

const IDP = "https://accounts.lumorphia.test:4100";
const RP = "https://scenote.lumorphia.test:4101";
const DISCORD_MOCK = "http://127.0.0.1:4102";

// *.lumorphia.test を 127.0.0.1 に向け、spike の自己署名証明書を信頼する (spike だけ)
const tls = {
  key: readFileSync(new URL("./certs/key.pem", import.meta.url)),
  cert: readFileSync(new URL("./certs/cert.pem", import.meta.url)),
};
setGlobalDispatcher(
  new Agent({
    connect: {
      ca: tls.cert,
      lookup: (host, opts, cb) =>
        host.endsWith(".lumorphia.test")
          ? opts?.all
            ? cb(null, [{ address: "127.0.0.1", family: 4 }])
            : cb(null, "127.0.0.1", 4)
          : dns.lookup(host, opts, cb),
    },
  }),
);
const SECRET_IDP = "test-secret-idp-0123456789abcdef0123456789";
const SECRET_RP = "test-secret-rp-0123456789abcdef01234567890";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
};

// メモリの DB。memory adapter は structuredClone するので Proxy は使えない
const MODELS = [
  "user",
  "session",
  "account",
  "verification",
  "jwks",
  "oauthClient",
  "oauthAccessToken",
  "oauthRefreshToken",
  "oauthConsent",
  "oauthResource",
  "oauthClientResource",
  "oauthClientAssertion",
];
const memoryDb = () => Object.fromEntries(MODELS.map((m) => [m, []]));

// ---- Discord の偽物 (token と users/@me) ------------------------------------
const discordUser = {
  id: "1234567890",
  username: "hal",
  global_name: "Hal",
  email: "hal@example.com",
  verified: true,
  avatar: null,
};
http
  .createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (process.env.SPIKE_DEBUG) console.log("  [discord mock]", req.method, req.url);
    if (req.url.startsWith("/api/oauth2/token")) {
      res.end(
        JSON.stringify({
          access_token: "discord-at",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "identify email",
        }),
      );
    } else if (decodeURIComponent(req.url).startsWith("/api/users/@me")) {
      res.end(JSON.stringify(discordUser));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  })
  .listen(4102);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://discord.com/"))
    return originalFetch(DISCORD_MOCK + url.slice("https://discord.com".length), init);
  return originalFetch(input, init);
};

// ---- Lumorphia (IdP) --------------------------------------------------------
const idpDb = memoryDb();
// 旧 Prismtone の台帳 (計画 2 章)。(provider, accountId) -> 引き継ぎ待ち
const legacyLedger = [
  {
    service: "prismtone",
    providerId: "discord",
    accountId: discordUser.id,
    migratedAt: null,
  },
];
const backchannelReceived = [];

const idp = betterAuth({
  baseURL: IDP,
  basePath: "/api/auth",
  secret: SECRET_IDP,
  database: memoryAdapter(idpDb),
  emailAndPassword: { enabled: true },
  socialProviders: {
    discord: { clientId: "discord-client", clientSecret: "discord-secret" },
  },
  trustedOrigins: [IDP, RP],
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/consent",
      scopes: ["openid", "profile", "email", "offline_access", "lumorphia:identities"],
      customIdTokenClaims: (info) => lumorphiaClaims(info),
      customUserInfoClaims: (info) => lumorphiaClaims(info),
    }),
  ],
});
function lumorphiaClaims({ user, scopes }) {
  {
    const accounts = idpDb.account.filter((a) => a.userId === user.id);
    const identities = accounts.map((a) => ({
      provider: a.providerId,
      id: a.accountId,
    }));
    const pending = legacyLedger
      .filter(
        (l) =>
          !l.migratedAt &&
          identities.some((i) => i.provider === l.providerId && i.id === l.accountId),
      )
      .map((l) => l.service);
    return {
      "https://lumorphia.com/handle": user.name,
      "https://lumorphia.com/legacy_pending": pending,
      ...(scopes.includes("lumorphia:identities")
        ? { "https://lumorphia.com/identities": identities }
        : {}),
    };
  }
}
const idpHandler = toNodeHandler(idp);
https
  .createServer(tls, (req, res) => {
    if (req.url.startsWith("/login") || req.url.startsWith("/consent")) {
      res.end("login page");
      return;
    }
    if (req.url.startsWith("/.well-known/")) {
      // 発行元のメタデータを root にも出す (issuer が basePath 付きでも RP が見つけられるか見る)
      req.url = "/api/auth" + req.url;
    }
    idpHandler(req, res);
  })
  .listen(4100);

// ---- サービス (RP) ----------------------------------------------------------
const rpDb = memoryDb();
let rpProfile = null;
let rpConfig = null;
const rp = () =>
  betterAuth({
    baseURL: RP,
    basePath: "/api/auth",
    secret: SECRET_RP,
    database: memoryAdapter(rpDb),
    trustedOrigins: [RP],
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "lumorphia",
            discoveryUrl: rpConfig.discoveryUrl,
            clientId: rpConfig.clientId,
            clientSecret: rpConfig.clientSecret,
            scopes: ["openid", "profile", "email", "lumorphia:identities"],
            pkce: true,
            mapProfileToUser: (profile) => {
              rpProfile = profile;
              return {};
            },
          },
        ],
      }),
    ],
  });
let rpHandler = null;
https
  .createServer(tls, (req, res) => {
    if (req.url.startsWith("/backchannel-logout")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        backchannelReceived.push(new URLSearchParams(body).get("logout_token"));
        res.end("ok");
      });
      return;
    }
    if (req.url.startsWith("/done")) {
      res.end("done");
      return;
    }
    rpHandler(req, res);
  })
  .listen(4101);

// ---- ブラウザの代わり ---------------------------------------------------------
class Browser {
  jars = new Map();
  cookieHeader(url) {
    const jar = this.jars.get(new URL(url).origin) ?? new Map();
    return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  store(url, res) {
    const origin = new URL(url).origin;
    const jar = this.jars.get(origin) ?? new Map();
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    this.jars.set(origin, jar);
  }
  /** node:https で送る。fetch (undici) は sec-fetch-mode: cors を強制するので、画面遷移を再現できない */
  request(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const headers = {
      ...(method === "GET"
        ? {
            accept: "text/html",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
          }
        : { "sec-fetch-mode": "cors" }),
      ...(init.headers ?? {}),
      cookie: this.cookieHeader(url),
      origin: u.origin,
    };
    const lib = u.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        u,
        {
          method,
          headers,
          ca: tls.cert,
          lookup: (h, o, cb) =>
            h.endsWith(".lumorphia.test")
              ? o?.all
                ? cb(null, [{ address: "127.0.0.1", family: 4 }])
                : cb(null, "127.0.0.1", 4)
              : dns.lookup(h, o, cb),
        },
        (r) => {
          const chunks = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => {
            const hdrs = new Headers();
            for (const [k, v] of Object.entries(r.headers))
              for (const x of [].concat(v)) hdrs.append(k, x);
            const res = new Response(
              r.statusCode === 204 || r.statusCode === 304 ? null : Buffer.concat(chunks),
              { status: r.statusCode, headers: hdrs },
            );
            this.store(url, res);
            resolve(res);
          });
        },
      );
      req.on("error", reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  }
  /** 302 をたどる。止まったところ (200 か、外の世界) の URL と応答を返す */
  async follow(url, stopAt = () => false) {
    let current = url;
    for (let i = 0; i < 20; i++) {
      if (stopAt(current)) return { url: current, res: null };
      const res = await this.request(current);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).href;
        continue;
      }
      return { url: current, res };
    }
    throw new Error("too many redirects");
  }
  async postJson(url, body) {
    const res = await this.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { res, json, text };
  }
}

const isDiscordAuthorize = (u) => u.startsWith("https://discord.com/");

async function main() {
  await new Promise((r) => setTimeout(r, 300));

  // 1. 発行元のメタデータ
  const metaRes = await originalFetch(`${IDP}/api/auth/.well-known/openid-configuration`);
  const meta = metaRes.ok ? await metaRes.json() : null;
  check("discovery を basePath の下で出す", !!meta, `status ${metaRes.status}`);
  const rootMeta = await originalFetch(`${IDP}/.well-known/openid-configuration`);
  check("discovery を root でも出せる", rootMeta.ok, `status ${rootMeta.status}`);
  if (!meta) return;
  console.log("  issuer:", meta.issuer);
  console.log(
    "  endpoints:",
    meta.authorization_endpoint,
    meta.token_endpoint,
    meta.userinfo_endpoint,
    meta.jwks_uri,
    meta.end_session_endpoint,
  );
  check("PKCE S256 を広告する", (meta.code_challenge_methods_supported ?? []).includes("S256"));
  check(
    "back-channel logout を広告する",
    meta.backchannel_logout_supported === true,
    String(meta.backchannel_logout_supported),
  );

  // 2. サービスをクライアントとして登録 (自社のサービスなので同意画面を出さない)
  // クライアントの登録には運営者のセッションが要る (SERVER_ONLY でも session を見る)
  await idp.api.signUpEmail({
    body: {
      email: "operator@example.com",
      password: "password-1234",
      name: "operator",
    },
  });
  const opRes = await idp.api.signInEmail({
    body: { email: "operator@example.com", password: "password-1234" },
    asResponse: true,
  });
  const opHeaders = new Headers({
    cookie: opRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
  let client;
  try {
    client = await idp.api.adminCreateOAuthClient({
      headers: opHeaders,
      body: {
        client_name: "Scenote (spike)",
        redirect_uris: [`${RP}/api/auth/callback/lumorphia`],
        post_logout_redirect_uris: [`${RP}/done`],
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        skip_consent: true,
        enable_end_session: true,
        scope: "openid profile email lumorphia:identities",
      },
    });
    check(
      "サーバーの API でクライアントを登録できる",
      !!client?.client_id,
      `skip_consent ${client?.skip_consent}`,
    );
  } catch (e) {
    check(
      "サーバーの API でクライアントを登録できる",
      false,
      JSON.stringify({ msg: e.message, body: e.body, status: e.status }).slice(0, 500),
    );
    return;
  }

  // back-channel の URI は https と公開アドレスしか受け付けない (localhost では登録できない) ことを確かめる
  try {
    await idp.api.adminCreateOAuthClient({
      headers: opHeaders,
      body: {
        client_name: "bc",
        redirect_uris: [`${RP}/cb`],
        backchannel_logout_uri: `${RP}/backchannel-logout`,
        skip_consent: true,
      },
    });
    check("back-channel の URI に *.lumorphia.test (127.0.0.1 に解決) を登録できる", true);
  } catch (e) {
    check(
      "back-channel の URI に *.lumorphia.test (127.0.0.1 に解決) を登録できる",
      false,
      e?.body?.error_description ?? e.message,
    );
  }

  rpConfig = {
    discoveryUrl: `${IDP}/api/auth/.well-known/openid-configuration`,
    clientId: client.client_id,
    clientSecret: client.client_secret,
  };
  rpHandler = toNodeHandler(rp());

  // 3. Discord で Lumorphia にログインし、サービスへ戻る (旧 Prismtone 利用者)
  const browser = new Browser();
  const start = await browser.postJson(`${RP}/api/auth/sign-in/social`, {
    provider: "lumorphia",
    callbackURL: `${RP}/done`,
  });
  check(
    "サービスがログインの URL を返す",
    !!start.json?.url,
    `${start.res.status} ${start.text.slice(0, 300)}`,
  );
  const authUrl = new URL(start.json.url);
  check("認可要求に PKCE が付く", authUrl.searchParams.get("code_challenge_method") === "S256");

  const toLogin = await browser.follow(start.json.url);
  check(
    "未ログインなら Lumorphia のログイン画面へ",
    toLogin.url.startsWith(`${IDP}/login`),
    toLogin.url,
  );
  const oauthQuery = new URL(toLogin.url).search.slice(1);

  const social = await browser.postJson(`${IDP}/api/auth/sign-in/social`, {
    provider: "discord",
    callbackURL: "/",
    oauth_query: oauthQuery,
  });
  check(
    "ログイン画面から Discord へ",
    !!social.json?.url && isDiscordAuthorize(social.json.url),
    social.text.slice(0, 200),
  );
  const discordAuth = new URL(social.json.url);
  // Discord が承認して callback に戻した体
  const cb = new URL(discordAuth.searchParams.get("redirect_uri"));
  cb.searchParams.set("code", "discord-code");
  cb.searchParams.set("state", discordAuth.searchParams.get("state"));
  const back = await browser.follow(cb.href);
  check(
    "Discord から戻ると、認可の続きを経てサービスに戻る",
    back.url.startsWith(`${RP}/done`),
    back.url,
  );
  check(
    "サービスにセッションができる",
    rpDb.session.length === 1,
    `sessions ${rpDb.session.length}`,
  );
  check(
    "サービスに Lumorphia の sub で account ができる",
    rpDb.account.some((a) => a.providerId === "lumorphia"),
  );

  // 4. ID トークンとカスタム claim
  const rpAccount = rpDb.account.find((a) => a.providerId === "lumorphia");
  const idToken = rpAccount?.idToken;
  check("サービスが ID トークンを受け取る", !!idToken);
  if (idToken) {
    const jwks = await (await originalFetch(meta.jwks_uri)).json();
    try {
      const { payload } = await jwtVerify(idToken, createLocalJWKSet(jwks), {
        issuer: meta.issuer,
        audience: client.client_id,
      });
      check(
        "ID トークンの署名・issuer・audience を検証できる",
        true,
        `alg ${decodeJwt(idToken) && JSON.parse(Buffer.from(idToken.split(".")[0], "base64url")).alg}`,
      );
      console.log("  id_token claims:", JSON.stringify(payload));
      check(
        "ID トークンに legacy_pending: prismtone が載る",
        JSON.stringify(payload["https://lumorphia.com/legacy_pending"]) === '["prismtone"]',
      );
      check(
        "ID トークンに identities (discord, 1234567890) が載る",
        (payload["https://lumorphia.com/identities"] ?? []).some(
          (i) => i.provider === "discord" && i.id === discordUser.id,
        ),
      );
    } catch (e) {
      check("ID トークンの署名・issuer・audience を検証できる", false, e.message);
    }
  }
  console.log("  profile seen by RP mapProfileToUser:", JSON.stringify(rpProfile));
  check(
    "RP の mapProfileToUser にカスタム claim が届く",
    !!rpProfile?.["https://lumorphia.com/identities"],
  );

  // 5. 2 回目: Lumorphia にログイン済みなら画面を出さずに戻る (SSO)
  const browser2Start = await browser.postJson(`${RP}/api/auth/sign-in/social`, {
    provider: "lumorphia",
    callbackURL: `${RP}/done`,
  });
  const again = await browser.follow(browser2Start.json.url);
  check(
    "Lumorphia にログイン済みなら、ログイン画面なしで戻る",
    again.url.startsWith(`${RP}/done`),
    again.url,
  );

  // 6. 自前のログイン (MiAuth の代わりにメール) のあと、authorize にもう一度来れば続きになるか
  const b3 = new Browser();
  await idp.api.signUpEmail({
    body: {
      email: "miauth@example.com",
      password: "password-1234",
      name: "miauth-user",
    },
  });
  const s3 = await b3.postJson(`${RP}/api/auth/sign-in/social`, {
    provider: "lumorphia",
    callbackURL: `${RP}/done`,
  });
  const login3 = await b3.follow(s3.json.url);
  await b3.postJson(`${IDP}/api/auth/sign-in/email`, {
    email: "miauth@example.com",
    password: "password-1234",
  }); // oauth_query を付けない
  const resume = await b3.follow(
    `${IDP}/api/auth/oauth2/authorize?${new URL(login3.url).search.slice(1)}`,
  );
  check(
    "自前のログインのあと、署名付きの query で authorize に戻れば続きになる",
    resume.url.startsWith(`${RP}/done`),
    resume.url,
  );

  // 7. ログアウト (end-session)
  const rpAcc = rpDb.account.find((a) => a.providerId === "lumorphia");
  const endSession = new URL(meta.end_session_endpoint);
  endSession.searchParams.set("id_token_hint", rpAcc.idToken);
  endSession.searchParams.set("client_id", client.client_id);
  endSession.searchParams.set("post_logout_redirect_uri", `${RP}/done`);
  const out = await browser.follow(endSession.href);
  console.log("  end-session landed:", out.url, out.res?.status);
  const after = await browser.postJson(`${RP}/api/auth/sign-in/social`, {
    provider: "lumorphia",
    callbackURL: `${RP}/done`,
  });
  const afterLogout = await browser.follow(after.json.url);
  check(
    "end-session のあと、Lumorphia のログインが要る",
    afterLogout.url.startsWith(`${IDP}/login`),
    afterLogout.url,
  );

  // 8. JWKS の鍵
  const jwks = await (await originalFetch(meta.jwks_uri)).json();
  console.log(
    "  jwks keys:",
    jwks.keys.map((k) => `${k.kid?.slice(0, 8)} ${k.alg ?? k.kty} ${k.crv ?? ""}`).join(", "),
  );
  console.log("  idp tables:", Object.keys(idpDb).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    check("spike を最後まで実行", false, e.message);
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(0);
  });
