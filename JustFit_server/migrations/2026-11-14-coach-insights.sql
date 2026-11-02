-- Coach Insights (asked for by the user on 2026-11-02): the AI Coach's Insights tab shows the
-- member's week (food, workouts, weight) and the coach's weekly review. In order:
--   1. coach_insights: the saved review, one per member per week
--   2. ai_usage accepts the new AI feature `coach_insights`
--   3. weigh_ins gets each member's current profile weight, dated the day the profile was last
--      saved, so the Weight card has a starting point (from now on every weight change in
--      Profile › Measurements adds a weigh-in). Only members with no weigh-in on that day.
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-13-fitness-categories.sql, by hand, with an account allowed to create and alter tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-14-coach-insights.sql

-- 1. The review
CREATE TABLE IF NOT EXISTS coach_insights (
  user_id     VARCHAR(64)   NOT NULL,
  week_start  DATE          NOT NULL,
  summary     VARCHAR(400)  NOT NULL,
  tips        JSON          NOT NULL,
  facts_hash  CHAR(32)      NOT NULL,
  made_on     DATE          NOT NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, week_start),
  CONSTRAINT fk_coach_insights_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- 2. The AI feature
ALTER TABLE ai_usage MODIFY COLUMN feature
  ENUM('gym_assistant', 'coach_plan', 'coach_workout', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report', 'exercise_library', 'workout_place', 'fitness_program', 'coach_insights') NOT NULL;

-- 3. A starting weigh-in from the profile
INSERT IGNORE INTO weigh_ins (user_id, logged_on, weight_kg)
  SELECT user_id, DATE(updated_at), weight_kg FROM profiles WHERE weight_kg IS NOT NULL AND weight_kg BETWEEN 25 AND 350;
