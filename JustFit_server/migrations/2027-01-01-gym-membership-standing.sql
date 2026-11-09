-- Gym Hub ecosystem (the user's brief of 2026-11-09): membership states and the gym's pause policy.
--   1. gym_members.standing: active (the default), suspended or cancelled by the gym, with the
--      reason, when and by whom. A suspended or cancelled membership can't check in or ask for a
--      pause until the gym reactivates it.
--   2. gyms.pause_policy: the branch's limits on members' pause requests (pauses and days in any
--      12 months, the longest single pause); NULL keeps justFit's defaults.
--
-- Adds columns only; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-01-gym-membership-standing.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'standing');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_members
  ADD COLUMN standing ENUM(''active'', ''suspended'', ''cancelled'') NOT NULL DEFAULT ''active'' AFTER expires_on,
  ADD COLUMN standing_note VARCHAR(200) NULL AFTER standing,
  ADD COLUMN standing_at TIMESTAMP NULL AFTER standing_note,
  ADD COLUMN standing_by VARCHAR(64) NULL AFTER standing_at,
  ADD CONSTRAINT fk_gym_members_standing_by FOREIGN KEY (standing_by) REFERENCES users (id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'pause_policy');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms ADD COLUMN pause_policy JSON NULL AFTER crowd_thresholds', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
