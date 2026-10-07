#!/bin/bash
# 秘密や DB の生のエラーをログに出さず、完了した dump だけを転送する。
set -euo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_BACKUP_ENDPOINT:?R2_BACKUP_ENDPOINT is required}"
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET is required}"
: "${R2_BACKUP_ACCESS_KEY_ID:?R2_BACKUP_ACCESS_KEY_ID is required}"
: "${R2_BACKUP_SECRET_ACCESS_KEY:?R2_BACKUP_SECRET_ACCESS_KEY is required}"
export RCLONE_CONFIG_BACKUP_TYPE=s3
export RCLONE_CONFIG_BACKUP_PROVIDER=Cloudflare
export RCLONE_CONFIG_BACKUP_ENDPOINT="$R2_BACKUP_ENDPOINT"
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_BACKUP_ACL=private
export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true

run_once() (
  local dump key
  dump="$(mktemp /tmp/accounts-backup-XXXXXX.dump)"
  trap 'rm -f "$dump"' EXIT
  key="pg/$(date -u +%Y-%m-%dT%H-%M-%SZ).dump"
  if ! pg_dump --dbname="$DATABASE_URL" --format=custom --compress=6 --file="$dump" >/dev/null 2>&1; then
    echo 'backup failed: dump' >&2
    exit 1
  fi
  if [ ! -s "$dump" ]; then echo 'backup failed: empty dump' >&2; exit 1; fi
  if ! rclone copyto "$dump" "backup:${R2_BACKUP_BUCKET}/${key}" >/dev/null 2>&1; then
    echo 'backup failed: upload' >&2
    exit 1
  fi
  echo 'backup ok'
)
case "${1:-once}" in
  once) run_once ;;
  loop)
    # 公開前の最初のバックアップも取る。監視はリモートのオブジェクト時刻を確認する。
    while true; do run_once || true; sleep 86400; done
    ;;
  list) rclone lsf "backup:${R2_BACKUP_BUCKET}/pg/" ;;
  *) echo 'usage: backup.sh once|loop|list' >&2; exit 2 ;;
esac
