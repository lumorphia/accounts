# ADR-0003: OIDC の発行元は Better Auth の oauth-provider、サービスは generic-oauth で受ける

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

各サービスは Lumorphia アカウントに「Lumorphia でログイン」する (`docs/plan.md` 1 章)。発行元に何を使うかを、A0 の spike (`spikes/a0-oidc/`) で確かめた。候補は Better Auth の `@better-auth/oauth-provider` と、OIDC の認定を受けた `oidc-provider` (panva) だった。prismtone はすでに Better Auth を使っている。

spike では 21 項目すべてが通った: discovery、PKCE (S256)、運営者のセッションでのクライアント登録、同意画面を出さない自社のクライアント、Discord でのログインから認可の続きを経てサービスに戻る流れ、ID トークンの検証 (EdDSA、JWKS)、カスタム claim、SSO、自前のログイン (MiAuth の代わり) のあとの続き、end-session。

## Decision

- 発行元は **Better Auth 1.7.7 + `@better-auth/oauth-provider` 1.7.7**。`jwt` プラグインで ID トークンを署名する
- サービス側は **Better Auth の `generic-oauth`**。共通の受け口を lumorphia/platform の `@lumorphia/auth-client` にまとめる (A1.2)
- spike で分かった次の点を設計に入れる
  - web クライアントの redirect URI は https かつループバック以外に限られる。開発と E2E も `*.lumorphia.test` と TLS (ADR-0002)
  - back-channel logout は 1 回しか送らない (仕様 §2.5)。ログアウトの知らせには使うが、退会の知らせは送り直しのある自前の webhook にする (`docs/plan.md` 3 章)
  - クライアントの登録 (`adminCreateOAuthClient`) にも運営者のセッションが要る。登録はスクリプトを運営者のアカウントで動かす
  - `generic-oauth` (1.7) は専用の入口を持たない。サービスは `/sign-in/social` に `provider: "lumorphia"` を渡し、callback は `/api/auth/callback/lumorphia`
  - カスタム claim は `customIdTokenClaims` と `customUserInfoClaims` の両方に載せる
  - MiAuth と Mastodon (自前のログイン) は、ログインの前に署名付きの query を持っておき、ログインのあと `/api/auth/oauth2/authorize?<query>` に戻す
  - `identities` (引き継ぎ用のプロバイダーの組) は、登録した scope で prismtone のクライアントにだけ渡す

## Consequences

### 良い点

- prismtone の Better Auth の作り (ログイン 5 種、MiAuth、Mastodon) をそのまま移せる
- 発行元とサービス側が同じライブラリで、版を合わせて上げられる

### 悪い点・受け入れるリスク

- `@better-auth/oauth-provider` は OIDC の認定を受けていない。仕様から外れた振る舞いが見つかったら、E2E で押さえてから直すか、`oidc-provider` に替える
- Better Auth は破壊的な変更が多い (prismtone ADR-0004)。版を固定し、上げるときは発行元とサービスの E2E を通す

### 追従して必要になること

- A0 で確かめていないもの (back-channel logout の実際の配送、署名の鍵の更新、PostgreSQL で動かすこと) を A1.2 の E2E で確かめる

## Alternatives

- `oidc-provider` (panva) を発行元にし、ログインの画面は Better Auth に任せる: 認定を受けている。ただ 2 つの仕組みのセッションをつなぐ作りが要る。Better Auth の oauth-provider で困ってから考える

## References

- `spikes/a0-oidc/README.md`、`docs/plan.md`
- lumorphia/prismtone ADR-0004
