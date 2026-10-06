# ADR-0001: ADR を用いて設計判断を記録する

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

lumorphia/accounts (Lumorphia アカウント) は、Prismtone・Scenote・今後のサービスのログインとキャラクターを受け持つ。ここでの判断は、すべてのサービスと利用者の移行に及ぶ。lumorphia/prismtone、lumorphia/platform、lumorphia/scenote と同じく、判断の理由を残す。

## Decision

設計上の重要な判断は ADR として `docs/adr/` に記録する。

- 形式は `0000-template.md` に従う。ファイル名は `NNNN-kebab-case-title.md`、番号は通し番号
- 一度 Accepted にした ADR は書き換えず、覆す場合は新しい ADR を作り、旧 ADR の Status を `Superseded by ADR-NNNN` にする
- 「重要な判断」の目安: サービスに渡すもの (claim、API、退会の知らせ) が変わる、利用者のデータの扱いが変わる、外部サービスへの依存が増減する、のいずれか
- prismtone から移したコードの判断は、prismtone の ADR を参照する (コピーしない)
- 全体の計画と段階は `docs/plan.md` に置く

## Consequences

### 良い点

- サービスの側から、アカウントの判断の理由を追える

### 悪い点・受け入れるリスク

- 記録の手間が増える。上の目安で線を引く

## Alternatives

- `docs/plan.md` だけに書く: 判断と計画が混ざり、覆したときの履歴が残らない

## References

- `docs/plan.md`
