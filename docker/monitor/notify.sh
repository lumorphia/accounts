#!/bin/bash
# VPS の cron から回し、滞留とバックアップの遅れを Discord に知らせる (docs/runbook/monitoring.md)。
#   */5 * * * * notify.sh backlog   処理の滞留 (backlog.sh)
#   17 * * * *  notify.sh backup    最新の dump が 26 時間より古い
# 同じ知らせは 1 時間に 1 回。直ったら復旧を 1 回送る。利用者の ID・handle・受信先は送らない。
set -uo pipefail
root="${ACCOUNTS_ROOT:-/srv/accounts}"
state_dir="${STATE_DIR:-/var/tmp/accounts-monitor}"
repeat_seconds="${REPEAT_SECONDS:-3600}"
backup_max_hours="${BACKUP_MAX_HOURS:-26}"
label="${HOST_LABEL:-accounts}"
cd "$root" || { echo "notify: cannot cd to $root" >&2; exit 2; }
if [ -z "${DISCORD_WEBHOOK_URL:-}" ] && [ -f .env.monitor ]; then
  DISCORD_WEBHOOK_URL="$(grep -E '^DISCORD_WEBHOOK_URL=' .env.monitor | cut -d= -f2- | tr -d '"')"
fi
mkdir -p "$state_dir"

send() {
  local payload
  payload="$(printf '{"content":"[%s] %s"}' "$label" "$1")"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -H 'content-type: application/json' -d "$payload" "$DISCORD_WEBHOOK_URL" >/dev/null \
      && return 0
    echo "notify: discord send failed" >&2
  else
    echo "notify: DISCORD_WEBHOOK_URL is not set" >&2
  fi
  return 1
}

# $1: 項目、$2: ok か alert、$3: 詳細
report() {
  local file="$state_dir/$1" now
  now="$(date +%s)"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1=$2 $3"
  if [ "$2" = alert ]; then
    if [ ! -f "$file" ] || [ $((now - $(cat "$file"))) -ge "$repeat_seconds" ]; then
      # 送れなかったら記録せず、次の回にもう一度送る
      send "$1: $3" && echo "$now" >"$file"
    fi
  elif [ -f "$file" ]; then
    send "$1: 復旧しました" && rm -f "$file"
  fi
}

check_backlog() {
  local out
  if out="$(ACCOUNTS_ROOT="$root" docker/monitor/backlog.sh 2>/dev/null)"; then
    report backlog ok "-"
  elif [ -z "$out" ]; then
    report backlog alert "滞留の確認に失敗しました"
  else
    # 0 でない項目の名前と件数だけ
    report backlog alert "滞留 $(printf '%s\n' "$out" | awk -F= '$2 + 0 > 0' | paste -sd' ')"
  fi
}

check_backup() {
  local latest stamp taken age_hours
  latest="$(docker compose --env-file .env.production -f compose.prod.yaml run --rm --no-deps -T backup list 2>/dev/null \
    | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z\.dump$' | sort | tail -n 1)"
  if [ -z "$latest" ]; then
    report backup alert "バックアップの一覧を取れないか、dump がありません"
    return
  fi
  # 2026-10-11T01-28-31Z.dump -> 2026-10-11T01:28:31Z
  stamp="$(printf '%s' "${latest%.dump}" | sed -E 's/T([0-9]{2})-([0-9]{2})-([0-9]{2})Z/T\1:\2:\3Z/')"
  taken="$(date -u -d "$stamp" +%s 2>/dev/null)" || { report backup alert "dump の時刻を読めません"; return; }
  age_hours=$((($(date +%s) - taken) / 3600))
  if [ "$age_hours" -ge "$backup_max_hours" ]; then
    report backup alert "最新の dump が ${age_hours} 時間前です"
  else
    report backup ok "${age_hours}h"
  fi
}

case "${1:-}" in
  backlog) check_backlog ;;
  backup) check_backup ;;
  *) echo 'usage: notify.sh backlog|backup' >&2; exit 2 ;;
esac
