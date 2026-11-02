-- Workout › At home / At center: keep the history when the equipment changes (QA fix, 2026-11-02).
-- Changing the location sheet used to delete every untrained adapted day, with the overrides
-- pointing at it, so a past missed adapted session vanished from the history; a trained one was
-- kept and then reused for new dates with the old equipment. Now an adapted day that a past date
-- or a log still uses is retired instead: kept for the history, never reused. In order:
--   1. workout_days gets `retired_at` (NULL while the day can still be reused)
--   2. `place_key` gives a retired day a key of its own, so a new adapted day for the same plan,
--      weekday and place can be made (the one-per-weekday-and-place key otherwise refuses it)
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-09-fitness-programs.sql, by hand, with an account allowed to alter tables (justfit_app
-- can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-11-workout-retired-days.sql

-- 1. When an adapted day was retired
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_days' AND COLUMN_NAME = 'retired_at'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE workout_days ADD COLUMN retired_at TIMESTAMP NULL AFTER program_session_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. A retired day's own key ("retired:" and its id), out of the way of the live ones
SET @has_expr := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_days' AND COLUMN_NAME = 'place_key'
    AND GENERATION_EXPRESSION LIKE '%retired%'
);
SET @sql := IF(@has_expr = 0, 'ALTER TABLE workout_days MODIFY COLUMN place_key VARCHAR(48) AS (IF(retired_at IS NULL, COALESCE(place, program_session_id, ''plan''), CONCAT(''retired:'', id))) STORED', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
