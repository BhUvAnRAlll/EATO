-- Gym Hub ecosystem (the user's brief of 2026-11-09, G18): a gallery photo can show one facility
-- (the steam room, the parking, the cardio floor), from the list in gym/profileRules.js. Members
-- see the facility under the photo. Like removing a photo, tagging one shows at once (no Publish).
-- NULL: the photo shows no facility.
--
-- Adds one column; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-24-gym-photo-facilities.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_photos' AND COLUMN_NAME = 'facility');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_photos ADD COLUMN facility VARCHAR(30) NULL AFTER image_key', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
