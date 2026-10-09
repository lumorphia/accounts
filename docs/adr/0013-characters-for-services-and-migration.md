# ADR-0013: サービスに未認証のキャラクターも渡し、引き継ぎでキャラクターを取り込む

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-09 |
| Deciders | t1nyb0x    |

## Context

キャラクターと Lodestone の確認は Lumorphia で行う (plan.md)。サービスは `GET /api/characters` (`lumorphia:characters`) で本人のキャラクターを読むが、A1.3 では認証済みだけを返していた。Prismtone は未認証のキャラクターも「未認証」の印付きで投稿に付けられる (prismtone ADR-0013)。認証済みだけを渡すと、Lumorphia でログインした人は認証しないと投稿にキャラクターを付けられなくなる。

plan.md では、Prismtone で確認済みのキャラクターは引き継ぎのときに Lumorphia へ移し、確認済みのまま扱うと決めた。確認したのは自分たちのシステムなので、やり直させない。未認証のキャラクターも移す。A1.5 の引き継ぎの完了 (`POST /api/legacy/prismtone/complete`) はキャラクターを受け取っていなかった。

## Decision

- `GET /api/characters` は **未認証のキャラクターも** `verified: false` で返す。返す項目は今のまま (確認用のトークンや運用上のエラーは渡さない)。サービスは印で見分けて表示する
- 引き継ぎの完了の本文に、旧サービスのキャラクター (`characters`、Lodestone の ID があるものだけ、40 件まで) を足せる。accounts は引き継ぎと同じトランザクションで取り込み、応答の `characters` で Lodestone の ID ごとの accounts のキャラクター ID と認証済みかを返す
  - 旧サービスで認証済みなら、認証済みのまま取り込む。ただし同じ Lodestone の ID がほかの Lumorphia の利用者に認証済みなら、未認証として取り込む (認証済みのキャラクターは 1 人にしか結び付けない)
  - 本人がすでに同じ Lodestone の ID のキャラクターを持っていれば、新しく作らずそれを使う
  - 本人に主キャラクターが無ければ、旧サービスの主キャラクターを主にする
  - 同じ旧利用者と同じ選択の送り直しは、取り込み済みの対応を返す (重ねて作らない)
- Lodestone の ID が無いキャラクターは受け取らない。旧サービスが自分のところに残す (prismtone ADR-0057)

## Consequences

サービスは、未認証のキャラクターも含めて本人のキャラクターを写せる。認証済みかどうかはサービスが印で出す。

旧サービスの「認証済み」を信じて取り込むので、取り込みは Prismtone のクライアント (`lumorphia_service: prismtone`、`lumorphia:legacy`) で、引き継ぎの台帳と本人の連携が一致したときだけ受け付ける (A1.5 と同じ確認)。

## References

- [plan.md](../plan.md) 2 章「キャラクター」
- [ADR-0009](0009-legacy-ledger-and-handle-reservations.md)
- lumorphia/prismtone ADR-0013・ADR-0056・ADR-0057
