-- Program page photos (asked for by the user on 2026-11-03): a program's screen shows its own
-- photo at the top, uploaded by the admin from the program's edit screen (Admin › Programs),
-- separate from the cover on its card. Like the cover, it is a file on the server's disk
-- (fitness/covers.js, COVER_DIR); the row only names it. In order:
--   1. fitness_programs gets `hero_key` (the file's name, NULL while the program has none: the
--      screen shows the palette's gradient) and `hero_updated_at` (when it last changed)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-15-fit-mama.sql, by hand, with an account allowed to alter tables (justfit_app can't),
-- for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-16-program-hero.sql

-- 1. The page photo
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_programs' AND COLUMN_NAME = 'hero_key'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE fitness_programs ADD COLUMN hero_key VARCHAR(64) NULL AFTER cover_updated_at, ADD COLUMN hero_updated_at TIMESTAMP(3) NULL AFTER hero_key', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
