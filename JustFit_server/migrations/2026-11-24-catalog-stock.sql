-- Product stock and PT lengths (asked for by the user on 2026-11-04, from the GymOps designs):
-- a product in Plans / Catalogue shows how many are in stock ("18 in stock"), and selling one to a
-- member (the member's ⋯ › Sell Product) takes them out of stock; a PT package shows its length
-- ("1 Month") and fills the PT period when picked. In order:
--   1. gym_catalog_items gets stock (products only; NULL = not counted)
--   2. the length rule lets a PT package have a length too (plans must have one, PT may): the old
--      check chk_gym_catalog_length is replaced by chk_gym_catalog_lengths
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-23-member-details.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-24-catalog-stock.sql

-- 1. Stock
SET @has_stock := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND COLUMN_NAME = 'stock');
SET @sql := IF(@has_stock = 0, 'ALTER TABLE gym_catalog_items ADD COLUMN stock INT UNSIGNED NULL AFTER price, ADD CONSTRAINT chk_gym_catalog_stock CHECK (stock IS NULL OR (kind = ''product'' AND stock <= 100000))', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. PT lengths: the old rule out, the new one in
SET @has_old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND CONSTRAINT_NAME = 'chk_gym_catalog_length');
SET @sql := IF(@has_old = 1, 'ALTER TABLE gym_catalog_items DROP CHECK chk_gym_catalog_length', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND CONSTRAINT_NAME = 'chk_gym_catalog_lengths');
SET @sql := IF(@has_new = 0, 'ALTER TABLE gym_catalog_items ADD CONSTRAINT chk_gym_catalog_lengths CHECK (
    (kind IN (''plan'', ''pt'') AND ((duration_unit = ''months'' AND duration BETWEEN 1 AND 24) OR (duration_unit = ''days'' AND duration BETWEEN 1 AND 365)))
    OR (kind <> ''plan'' AND duration IS NULL AND duration_unit IS NULL))', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
