#!/bin/bash
# VPS の既存の監視から実行し、終了コード 1 を通知につなぐ。利用者情報は出さない。
set -euo pipefail
root="${ACCOUNTS_ROOT:-/srv/accounts}"
cd "$root"
result="$(docker compose --env-file .env.production -f compose.prod.yaml exec -T postgres psql -X -U accounts -d accounts -v ON_ERROR_STOP=1 -At < docker/monitor/backlog.sql)" || { echo 'accounts backlog probe failed' >&2; exit 1; }
printf '%s\n' "$result"
if printf '%s\n' "$result" | awk -F= '$2 + 0 > 0 { found=1 } END { exit !found }'; then exit 1; fi
