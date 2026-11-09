-- Gym Hub ecosystem (the user's brief of 2026-11-09): live crowd and best time to visit. A branch
-- gets the crowd settings its gym admin chooses: how many people it holds at once (capacity), the
-- usual workout length (used when a visit never checked out) and where Moderate, Busy and Very
-- busy start (% of capacity). The live count and the forecast are worked out from gym_attendance
-- on every read; nothing about them is stored.
--
-- Adds three columns to gyms; nothing is changed or deleted. Safe to run more than once. Run by
-- hand, from JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-29-gym-crowd.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'capacity');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms
  ADD COLUMN capacity SMALLINT UNSIGNED NULL AFTER attendance_radius_m,
  ADD COLUMN avg_stay_min SMALLINT UNSIGNED NULL AFTER capacity,
  ADD COLUMN crowd_thresholds JSON NULL AFTER avg_stay_min,
  ADD CONSTRAINT chk_gyms_capacity CHECK (capacity IS NULL OR capacity BETWEEN 5 AND 2000),
  ADD CONSTRAINT chk_gyms_stay CHECK (avg_stay_min IS NULL OR avg_stay_min BETWEEN 15 AND 300)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
