-- Gym Hub phase 2, the gym's public profile (approved by the user on 2026-11-09): what members will
-- see about a branch when they discover gyms (phase 3). The gym admin fills it in from Settings ›
-- Public profile. The branch's address and phone (Invoice details), its place on the map
-- (Location & Attendance) and the gym's logo are reused as they are. In order:
--   1. gyms gets about (a short description), facilities (a JSON list of ids from
--      gym/profileRules.js) and opening_hours (JSON: up to two sessions a weekday)
--   2. gym_catalog_items gets details: a plan's or PT package's benefits and restrictions
--   3. gym_photos: the branch's gallery, up to 8 photos, files on the server's disk
--      (GYM_PHOTO_DIR, by default uploads/gym-photos, git-ignored) under random names
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-12-16-delivery-addresses.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-17-gym-public-profile.sql

-- 1. The branch's description, facilities and opening hours (NULL: not filled in yet)
SET @has_about := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'about');
SET @sql := IF(@has_about = 0, 'ALTER TABLE gyms ADD COLUMN about VARCHAR(500) NULL AFTER gstin, ADD COLUMN facilities JSON NULL AFTER about, ADD COLUMN opening_hours JSON NULL AFTER facilities', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. What a plan includes
SET @has_details := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND COLUMN_NAME = 'details');
SET @sql := IF(@has_details = 0, 'ALTER TABLE gym_catalog_items ADD COLUMN details VARCHAR(300) NULL AFTER stock', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. The gallery
CREATE TABLE IF NOT EXISTS gym_photos (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,                -- the branch it shows
  image_key   VARCHAR(64)  NOT NULL,                -- the file's name in GYM_PHOTO_DIR
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_photos_gym (gym_id, id),
  CONSTRAINT fk_gym_photos_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_photos_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
