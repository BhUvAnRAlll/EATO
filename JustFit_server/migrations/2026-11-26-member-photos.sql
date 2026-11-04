-- Member photos (asked for by the user on 2026-11-04): Add New Member can take or choose a photo
-- of the member. The photo is a file on the server's disk (MEMBER_PHOTO_DIR, by default
-- uploads/member-photos, git-ignored; gym/photos.js) under a random name; the row keeps only that
-- name, and only this branch's staff can read it. In order:
--   1. gym_members gets photo_key (NULL: no photo, the initials show)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-25-gym-sms.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-26-member-photos.sql

-- 1. The photo's file name
SET @has_photo := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'photo_key');
SET @sql := IF(@has_photo = 0, 'ALTER TABLE gym_members ADD COLUMN photo_key VARCHAR(64) NULL AFTER notes', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
