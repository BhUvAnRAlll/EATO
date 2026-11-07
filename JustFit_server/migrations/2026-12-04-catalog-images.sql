-- Catalogue item images (asked for by the user on 2026-11-07): Add Plan (and Edit) in Plans /
-- Catalogue can attach an optional picture of the plan, PT package, service or product, such as a
-- brochure photo; the card shows it as a thumbnail. The image is a file on the server's disk
-- (CATALOG_IMAGE_DIR, by default uploads/catalog-images, git-ignored; gym/catalogImages.js) under
-- a random name; the row keeps only that name, and only this branch's staff can read it. In order:
--   1. gym_catalog_items gets image_key (NULL: no image)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-12-03-coach-voice.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-04-catalog-images.sql

-- 1. The image's file name
SET @has_image := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND COLUMN_NAME = 'image_key');
SET @sql := IF(@has_image = 0, 'ALTER TABLE gym_catalog_items ADD COLUMN image_key VARCHAR(64) NULL AFTER stock', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
