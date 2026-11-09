-- Gym Hub ecosystem (the user's brief of 2026-11-09): gym roles. A Staff login is added as Gym Admin,
-- Manager, Receptionist or Attendance Staff, each a ready-made set of Role & Permission options
-- (gym/rolePresets.js). Someone invited before they ever signed in keeps that role on the invite
-- until they join; this adds the column it waits in. NULL: every option (Gym Admin), as before.
--
-- Adds one column; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-03-gym-role-presets.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_staff_invites' AND COLUMN_NAME = 'permissions');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_staff_invites ADD COLUMN permissions JSON NULL AFTER kind', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
