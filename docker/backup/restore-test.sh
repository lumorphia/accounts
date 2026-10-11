#!/bin/bash
# 隔離した復元試験 (docs/runbook/backup.md)。compose.restore-test.yaml から使う。
# 復元先は試験用の restore-db だけ。dump・秘密・利用者の値はログに出さない。
set -euo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL is required}"

# 本番の DB (サービス名 postgres) へ戻す事故を防ぐ
case "$DATABASE_URL" in
  *@restore-db:5432/*) ;;
  *) echo 'restore-test: DATABASE_URL must point to restore-db' >&2; exit 2 ;;
esac

fetch_and_restore() (
  : "${R2_BACKUP_ENDPOINT:?R2_BACKUP_ENDPOINT is required}"
  : "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET is required}"
  : "${R2_BACKUP_ACCESS_KEY_ID:?R2_BACKUP_ACCESS_KEY_ID is required}"
  : "${R2_BACKUP_SECRET_ACCESS_KEY:?R2_BACKUP_SECRET_ACCESS_KEY is required}"
  export RCLONE_CONFIG_BACKUP_TYPE=s3
  export RCLONE_CONFIG_BACKUP_PROVIDER=Cloudflare
  export RCLONE_CONFIG_BACKUP_ENDPOINT="$R2_BACKUP_ENDPOINT"
  export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
  export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
  local key="${RESTORE_KEY:-}" dump
  if [ -z "$key" ]; then
    # キーは pg/<UTC の時刻>.dump なので、名前順の最後が最新
    key="pg/$(rclone lsf "backup:${R2_BACKUP_BUCKET}/pg/" 2>/dev/null | grep '\.dump$' | sort | tail -n 1)"
  fi
  if [ "$key" = "pg/" ]; then echo 'restore-test failed: no dump' >&2; exit 1; fi
  dump="$(mktemp /tmp/accounts-restore-XXXXXX.dump)"
  trap 'rm -f "$dump"' EXIT
  if ! rclone copyto "backup:${R2_BACKUP_BUCKET}/${key}" "$dump" >/dev/null 2>&1; then
    echo 'restore-test failed: download' >&2
    exit 1
  fi
  restore_file "$dump"
  echo "restore-test: restored ${key}"
)

restore_file() {
  if [ ! -s "$1" ]; then echo 'restore-test failed: empty dump' >&2; exit 1; fi
  if ! pg_restore --no-owner --no-acl --exit-on-error --dbname="$DATABASE_URL" "$1" >/dev/null 2>&1; then
    echo 'restore-test failed: pg_restore' >&2
    exit 1
  fi
  # 試験の worker に書かせるため、本番の心拍は持ち込まない
  psql -X -q --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DELETE FROM worker_heartbeats' >/dev/null
}

counts() {
  # 件数だけを出す。ID・handle・メール・受信先は出さない
  psql -X --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'users=' || count(*) FROM users;
SELECT 'users_' || status || '=' || count(*) FROM users GROUP BY status ORDER BY status;
SELECT 'accounts=' || count(*) FROM accounts;
SELECT 'sessions=' || count(*) FROM sessions;
SELECT 'characters=' || count(*) FROM characters;
SELECT 'characters_verified=' || count(*) FROM characters WHERE verified_at IS NOT NULL;
SELECT 'service_memberships=' || count(*) FROM service_memberships;
SELECT 'legacy_accounts=' || count(*) FROM legacy_accounts;
SELECT 'legacy_identities=' || count(*) FROM legacy_identities;
SELECT 'account_events_pending=' || count(*) FROM account_events WHERE delivered_at IS NULL;
SELECT 'asset_deletions_pending=' || count(*) FROM asset_deletions WHERE deleted_at IS NULL;
SELECT 'oauth_clients=' || count(*) FROM oauth_clients;
SELECT 'jwks=' || count(*) FROM jwks;
SELECT 'worker_heartbeats=' || count(*) FROM worker_heartbeats;
SQL
}

case "${1:-}" in
  restore) fetch_and_restore ;;
  restore-file) restore_file "${2:?usage: restore-test.sh restore-file <dump>}"; echo 'restore-test: restored file' ;;
  counts) counts ;;
  *) echo 'usage: restore-test.sh restore|restore-file <dump>|counts' >&2; exit 2 ;;
esac
