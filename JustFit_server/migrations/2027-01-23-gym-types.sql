-- Gym Hub ecosystem (the user's brief of 2026-11-09, G16): what kind of gym a branch is (Gym,
-- Women only, CrossFit / functional, Yoga & pilates, Martial arts & boxing, Dance & Zumba, Personal
-- training studio), up to three, from a fixed list in gym/profileRules.js. Part of the draft
-- profile: members see it once the branch publishes, and Discover filters by it. NULL: none picked.
--
-- Adds one column; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-23-gym-types.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'gym_types');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms ADD COLUMN gym_types JSON NULL AFTER facilities', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
