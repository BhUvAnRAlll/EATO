-- The plan's name on a member (asked for by the user on 2026-11-08): Members' cards show the
-- plan a member took ("Gold · 3 Months"), not only its length. Add Member and Renewal save the
-- name of the catalogue plan picked (looked up by the server from this branch's catalogue);
-- a custom plan saves none. In order:
--   1. gym_members gets plan_name (NULL: a custom plan, or saved before this)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Before it runs, members
-- keep working and the cards show the plan's length only. It needs no other migration first. Run
-- it by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-12-member-plan-name.sql

-- 1. The catalogue plan's name when it was bought (a copy: renaming the plan later keeps it)
SET @has_plan_name := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'plan_name');
SET @sql := IF(@has_plan_name = 0, 'ALTER TABLE gym_members ADD COLUMN plan_name VARCHAR(80) NULL AFTER plan_days', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
