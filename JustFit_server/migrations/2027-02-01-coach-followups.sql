-- The AI Coach's daily follow-up (2026-11-10): the evening notification opens the chat, and the
-- coach writes one check-in on the member's day (POST /api/coach/followup), saved as a coach
-- message in their conversation. Each call is recorded on Admin › AI Usage under the new feature;
-- before this runs the follow-up answers 503 naming this file. No new table.
-- Run once on a database set up before this date (the test database is rebuilt from schema.sql).
--
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-02-01-coach-followups.sql

ALTER TABLE ai_usage MODIFY COLUMN feature
  ENUM('gym_assistant', 'coach_plan', 'coach_workout', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report', 'exercise_library', 'workout_place', 'fitness_program', 'coach_insights', 'coach_voice', 'coach_followup') NOT NULL;
