-- Voice questions for the coach chat (2026-11-06): a phone whose own speech recogniser lacks the
-- member's language (an iPhone for Kannada) records a short clip, and POST /api/coach/voice
-- transcribes it with OpenAI's gpt-4o-mini-transcribe. Each call is recorded on Admin › AI Usage
-- under the new feature; the model needs a price row or the call is refused as unpriced.
-- Run once on a database set up before this date (the test database is rebuilt from schema.sql).
--
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-03-coach-voice.sql

ALTER TABLE ai_usage MODIFY COLUMN feature
  ENUM('gym_assistant', 'coach_plan', 'coach_workout', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report', 'exercise_library', 'workout_place', 'fitness_program', 'coach_insights', 'coach_voice') NOT NULL;

-- Billed by audio token ($3.00 per million; the few text tokens cost less, so this rounds up)
INSERT IGNORE INTO ai_model_prices (model, provider, input_usd_per_million, cached_input_usd_per_million, output_usd_per_million, request_usd) VALUES
  ('gpt-4o-mini-transcribe', 'openai', 3.0000, 3.0000, 5.0000, 0);
