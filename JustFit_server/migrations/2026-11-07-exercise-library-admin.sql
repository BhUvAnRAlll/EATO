-- Admin › Exercises (asked for by the user on 2026-11-01): every exercise a member can be given,
-- listed for the admin with whether it has a demo video yet, and grown by asking the AI for new
-- ones ("20 home yoga stretches"). In order:
--   1. the workout exercise library gets `ai_drafted` (the AI wrote the row) and `video_key` /
--      `video_uploaded_at` (the demo clip, filled by the video upload that comes next)
--   2. ai_usage accepts the new AI features `exercise_library` and `coach_workout` (the AI writing
--      members' workouts)
--   3. admin_audit_log accepts `exercise` as a target (adding, archiving and restoring)
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-06-remove-community.sql, by hand, with an account allowed to alter tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-07-exercise-library-admin.sql

-- 1. The library's new columns
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_exercise_library' AND COLUMN_NAME = 'ai_drafted'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE workout_exercise_library ADD COLUMN ai_drafted BOOLEAN NOT NULL DEFAULT FALSE AFTER built_in', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_exercise_library' AND COLUMN_NAME = 'video_key'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE workout_exercise_library ADD COLUMN video_key VARCHAR(200) NULL AFTER instructions', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_exercise_library' AND COLUMN_NAME = 'video_uploaded_at'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE workout_exercise_library ADD COLUMN video_uploaded_at TIMESTAMP NULL AFTER video_key', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The new AI features (the list as schema.sql has it, plus coach_workout and exercise_library)
ALTER TABLE ai_usage MODIFY COLUMN feature
  ENUM('gym_assistant', 'coach_plan', 'coach_workout', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report', 'exercise_library') NOT NULL;

-- 3. The new audit target
ALTER TABLE admin_audit_log MODIFY COLUMN target_type
  ENUM('user', 'gym', 'post', 'report', 'promotion', 'exercise') NOT NULL;
