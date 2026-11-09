-- Gym Hub ecosystem (the user's brief of 2026-11-09): featured gyms. A justFit admin can feature an
-- approved branch; members' Discover shows featured gyms first, with a badge. NULL: not featured.
--
-- Adds one column; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-21-featured-gyms.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'featured_at');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms ADD COLUMN featured_at TIMESTAMP NULL AFTER submitted_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
