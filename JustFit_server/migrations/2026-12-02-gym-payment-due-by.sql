-- Payment on time (gym prediction #2, approved by the user on 2026-11-06): a due payment keeps the
-- date the due was to be paid by (gym_payments.due_by, written by Collect Payment Due from the
-- member's due date at that moment), so the portal can tell a late payment from one on time.
-- Older due payments keep NULL and count as neither.
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-12-01-gym-staff-permissions.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-02-gym-payment-due-by.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_payments' AND COLUMN_NAME = 'due_by');
SET @sql := IF(@has = 0, "ALTER TABLE gym_payments ADD COLUMN due_by DATE NULL AFTER paid_on", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
