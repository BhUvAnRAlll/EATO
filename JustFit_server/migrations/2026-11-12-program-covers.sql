-- Program covers (asked for by the user on 2026-11-02): the admin uploads a cover photo for a
-- Fitness program from its edit screen (Admin › Programs), replaces it or removes it. The photo
-- is a file on the server's disk (fitness/covers.js, COVER_DIR, by default uploads/program-covers);
-- the row only names it. In order:
--   1. fitness_programs gets `cover_key` (the file's name, NULL while the program has no cover)
--      and `cover_updated_at` (when it last changed, so a replaced cover is never shown from a cache)
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-11-workout-retired-days.sql, by hand, with an account allowed to alter tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-12-program-covers.sql

-- 1. The cover
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_programs' AND COLUMN_NAME = 'cover_key'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE fitness_programs ADD COLUMN cover_key VARCHAR(64) NULL AFTER palette, ADD COLUMN cover_updated_at TIMESTAMP(3) NULL AFTER cover_key', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
