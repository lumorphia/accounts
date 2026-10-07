-- 個人の ID・handle・受信先を出さず、処理の滞留だけを数える。
SELECT 'notifications=' || count(*) FROM account_events WHERE delivered_at IS NULL AND occurred_at < now() - interval '15 minutes';
SELECT 'images=' || count(*) FROM asset_deletions WHERE deleted_at IS NULL AND created_at < now() - interval '15 minutes';
SELECT 'purges=' || count(*) FROM users WHERE status = 'deleted' AND deleted_at < now() - interval '30 days 1 hour';
SELECT 'service_purges=' || count(*) FROM service_memberships WHERE purged_at IS NULL AND deleted_at < now() - interval '30 days 1 hour';
SELECT 'characters=' || count(*) FROM characters c JOIN users u ON u.id = c.user_id WHERE u.status = 'active' AND c.verified_at IS NOT NULL AND coalesce(c.last_synced_at, c.verified_at) < now() - interval '8 days';
