-- Workout › At home / At center (asked for by the user on 2026-11-02): a member who trains
-- somewhere else today switches today's session to a version for that place (home equipment or a
-- full gym). In order:
--   1. workout_days gets `variant_of` (the plan day this one adapts; NULL for the plan's own days)
--      and `place` (home or center, for an adapted day). An adapted day is never a weekday of the
--      plan: a date runs it only through workout_day_overrides, and it is kept for reuse.
--   2. ai_usage accepts the new AI feature `workout_place` (adapting one session)
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-07-exercise-library-admin.sql, by hand, with an account allowed to alter tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-08-workout-place.sql

-- 1. The adapted days. The plan's one-day-per-weekday key becomes one per weekday and place
--    (`place_key` is "plan" for the plan's own days), so an adapted day can share its weekday.
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_days' AND COLUMN_NAME = 'variant_of'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE workout_days ADD COLUMN variant_of CHAR(36) NULL AFTER session_type, ADD COLUMN place ENUM(''home'', ''center'') NULL AFTER variant_of, ADD COLUMN place_key VARCHAR(6) AS (IFNULL(place, ''plan'')) STORED AFTER place, ADD KEY idx_workout_days_variant (variant_of, place)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_key := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_days' AND INDEX_NAME = 'uq_workout_days_plan_weekday_place'
);
SET @sql := IF(@has_key = 0, 'ALTER TABLE workout_days ADD UNIQUE KEY uq_workout_days_plan_weekday_place (plan_id, weekday, place_key), DROP INDEX uq_workout_days_plan_weekday', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The new AI feature (the list as schema.sql has it)
ALTER TABLE ai_usage MODIFY COLUMN feature
  ENUM('gym_assistant', 'coach_plan', 'coach_workout', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report', 'exercise_library', 'workout_place') NOT NULL;
