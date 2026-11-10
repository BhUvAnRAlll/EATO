-- Member notifications set by the gym (2026-11-10, the user's choice): members no longer switch
-- notifications themselves. Each branch's gym admin (or Staff with SMS › Member notifications)
-- chooses which membership and pause notices its members get; the Super Admin chooses complaint
-- updates in Platform settings (no column needed). The list holds the notice kinds the branch
-- does NOT send (notifications/rules.js MEMBER_KINDS); NULL means every notice is sent, as before.
--
-- Adds one column; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-26-member-notification-settings.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'member_notifications');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms ADD COLUMN member_notifications JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
