-- AI cost optimisation (2026-10-31): what the usage log needs to price calls accurately once the
-- server uses cheaper models, OpenAI's prompt cache and its own answer cache. Additive only:
-- two columns on ai_usage, one on ai_model_prices, one more feature value, and price rows for the
-- models the server can now be configured with (official list prices, developers.openai.com,
-- read 2026-10-31). Run ONCE, after 2026-11-03-ai-usage.sql, with an account allowed to alter
-- tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-04-ai-cost-optimization.sql
--
-- Until it has run, the server keeps working: usage rows are written the old way (cached tokens
-- are then billed at the full input price, so the dashboard over-estimates a little) and the
-- admin's AI Usage screen answers 503 with a line saying this migration is pending.

-- The part of a call's input OpenAI served from its prompt cache (billed cheaper), and whether
-- the server answered from its own cache without calling a model at all (no tokens, ₹0)
ALTER TABLE ai_usage
  ADD COLUMN cached_input_tokens INT UNSIGNED NOT NULL DEFAULT 0 AFTER input_tokens,
  ADD COLUMN from_cache          BOOLEAN      NOT NULL DEFAULT FALSE AFTER status,
  MODIFY COLUMN feature ENUM('gym_assistant', 'coach_plan', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report') NOT NULL;

-- A model's price for cached input tokens (NULL: the same as uncached input)
ALTER TABLE ai_model_prices
  ADD COLUMN cached_input_usd_per_million DECIMAL(10, 4) NULL AFTER input_usd_per_million;

UPDATE ai_model_prices SET cached_input_usd_per_million = 1.2500 WHERE model = 'gpt-4o';
UPDATE ai_model_prices SET cached_input_usd_per_million = 0.0750 WHERE model = 'gpt-4o-mini';

INSERT IGNORE INTO ai_model_prices (model, provider, input_usd_per_million, cached_input_usd_per_million, output_usd_per_million, request_usd) VALUES
  ('gpt-4.1',      'openai', 2.0000, 0.5000, 8.0000, 0),
  ('gpt-4.1-mini', 'openai', 0.4000, 0.1000, 1.6000, 0),
  ('gpt-4.1-nano', 'openai', 0.1000, 0.0250, 0.4000, 0),
  ('gpt-5-mini',   'openai', 0.2500, 0.0250, 2.0000, 0),
  ('gpt-5-nano',   'openai', 0.0500, 0.0050, 0.4000, 0);
