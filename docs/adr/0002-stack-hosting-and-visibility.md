# ADR-0002: prismtone と同じ構成・同じ VPS で動かし、リポジトリは public にする

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

Lumorphia アカウントは新しいサービスとして立てる (`docs/plan.md`)。ログイン 5 種、handle、表示名とアイコン、キャラクターと Lodestone の確認、退会、OIDC の発行元を持ち、画面もある。prismtone はその多くを持っていて、本番で動いている。

org の GitHub Actions は Free プランで、private リポジトリは月 2000 分まで。prismtone だけでも 1 回の PR で 15〜20 分使う。アカウントは E2E (ログイン 5 種を偽物のプロバイダーで回す) が重い。

## Decision

- **構成は prismtone と同じ**: React Router v7 (SSR) + Fastify、PostgreSQL + Drizzle、pg-boss、Better Auth、Docker Compose (lumorphia/scenote の ADR-0002 と同じ並び)。共通の基盤は lumorphia/platform のパッケージを使う (`media`・`storage`・`ops`)
- **開発と E2E も https**: 発行元のクライアントは https かつループバック以外の redirect URI しか登録できない (ADR-0003、A0 の発見 1)。`*.lumorphia.test` と TLS で組む
- **prismtone と同じ VPS で動かし、Postgres は別のコンテナにする**。Caddy と doco-cd の仕組みを使う。片方の DB の作業がもう片方に響かない
- **表示名とアイコンは Lumorphia で 1 つ**。自己紹介 (bio) だけはサービスごと。アイコンの画像は platform の `media` と `storage` で作り、Lumorphia の R2 のバケットに置く
- **画面は prismtone の部品 (shadcn/ui) を写して始める**。Lumorphia のデザインは、画面がそろってから整える
- **リポジトリは public (AGPL-3.0)**。安全はコードを隠すことではなく、鍵 (`.env` と GitHub の Secrets にあり、リポジトリには入れない) と正しい実装で守る。lumorphia/platform の ADR-0002 と同じ線
- **弱点の修正は非公開で行う**: 見つけた弱点は Issue や公開の PR に書かず、GitHub の非公開のセキュリティアドバイザリ (private fork) で直し、本番に入れてから公開する。手順は `SECURITY.md`

## Consequences

### 良い点

- CI の時間が org の上限を使わない。PR のたびに E2E まで回せる
- prismtone の運用の知識 (runbook、CI、doco-cd) がそのまま使える

### 悪い点・受け入れるリスク

- 攻撃する人もコードを読める。守る側も読める (Dependabot、CodeQL)。弱点をすぐ直せる体制と、非公開で直す手順で受ける
- うっかり入れたシークレットがそのまま公開される。pre-commit と CI の gitleaks で防ぎ、入ったら消すより先に鍵を作り直す
- VPS が止まると、prismtone とアカウントが一緒に止まる。ログイン済みの利用者は、各サービスのセッションで使い続けられる

## Alternatives

- private にする: CI のすべてが org の 2000 分を食う。隠して守れるものは無い
- 別の VPS に置く: 障害は分かれるが、費用と運用が増える
- Postgres を prismtone と共有する: メモリは節約できるが、片方の DB の作業がもう片方に響く

## References

- `docs/plan.md`、ADR-0003
- lumorphia/scenote ADR-0002、ADR-0005、ADR-0006
- lumorphia/platform ADR-0002
