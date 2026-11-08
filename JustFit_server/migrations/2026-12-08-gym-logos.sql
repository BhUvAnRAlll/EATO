-- Gym logos (asked for by the user on 2026-11-08): each gym prints its own logo at the top right of
-- its invoices. The gym admin uploads it from Branch details › Invoice details; it is the gym's
-- (gym_brands), so every branch's invoices carry the same logo. The image is a file on the server's
-- disk (GYM_LOGO_DIR, by default uploads/gym-logos, git-ignored; gym/logos.js) under a random name;
-- the row keeps only that name, and only the gym's own staff can read it. In order:
--   1. gym_brands gets logo_key (NULL: no logo)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-12-07-gym-invoices.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-08-gym-logos.sql

-- 1. The logo's file name
SET @has_logo := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_brands' AND COLUMN_NAME = 'logo_key');
SET @sql := IF(@has_logo = 0, 'ALTER TABLE gym_brands ADD COLUMN logo_key VARCHAR(64) NULL AFTER name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
