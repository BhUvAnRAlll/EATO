-- Gym Profile Management, phase 1 (approved by the user on 2026-11-09): the branch's profile becomes
-- a draft the gym admin (or Staff given the Gym Profile options) edits, previews and publishes.
-- Members see only the published copy. In order:
--   1. gyms gets the new contact fields (WhatsApp, email, website, Instagram, Facebook), the gym's
--      own facilities, special closures, what members may see (on/off per section), when the draft
--      was last edited, and the published copy with when and by whom it was published
--   2. gym_photos gets sort_order (the first is the cover), filled in from the order they were added
--   3. every branch that already had a public profile (Gym Hub phase 2) is published as it is, so
--      members keep seeing what they saw before
--
-- No table is created or dropped and nothing is deleted. Safe to run more than once. Run after
-- 2026-12-17-gym-public-profile.sql, by hand, from JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-21-gym-profile-publishing.sql

-- 1. The new columns on gyms
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'published_profile');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms
  ADD COLUMN whatsapp CHAR(10) NULL AFTER opening_hours,
  ADD COLUMN email VARCHAR(120) NULL AFTER whatsapp,
  ADD COLUMN website VARCHAR(200) NULL AFTER email,
  ADD COLUMN instagram VARCHAR(200) NULL AFTER website,
  ADD COLUMN facebook VARCHAR(200) NULL AFTER instagram,
  ADD COLUMN custom_facilities JSON NULL AFTER facebook,
  ADD COLUMN closures JSON NULL AFTER custom_facilities,
  ADD COLUMN profile_show JSON NULL AFTER closures,
  ADD COLUMN profile_edited_at TIMESTAMP(3) NULL AFTER profile_show,
  ADD COLUMN published_profile JSON NULL AFTER profile_edited_at,
  ADD COLUMN published_at TIMESTAMP(3) NULL AFTER published_profile,
  ADD COLUMN published_by VARCHAR(64) NULL AFTER published_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND CONSTRAINT_NAME = 'fk_gyms_published_by');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms ADD CONSTRAINT fk_gyms_published_by FOREIGN KEY (published_by) REFERENCES users (id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The gallery's order
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_photos' AND COLUMN_NAME = 'sort_order');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_photos ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_key', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
UPDATE gym_photos SET sort_order = id WHERE sort_order = 0;

-- 3. Profiles members could already see stay visible: published as they are now
UPDATE gyms g
SET g.published_profile = JSON_OBJECT(
      'about', g.about,
      'facilities', COALESCE(g.facilities, JSON_ARRAY()),
      'custom', JSON_ARRAY(),
      'hours', g.opening_hours,
      'closures', JSON_ARRAY(),
      'contact', JSON_OBJECT('address', g.address, 'phone', g.phone, 'whatsapp', NULL, 'email', NULL, 'website', NULL, 'instagram', NULL, 'facebook', NULL),
      'photos', NULL,
      'show', NULL),
    g.published_at = NOW(3)
WHERE g.published_profile IS NULL
  AND (g.about IS NOT NULL OR g.facilities IS NOT NULL OR g.opening_hours IS NOT NULL
       OR EXISTS (SELECT 1 FROM gym_photos p WHERE p.gym_id = g.id));
