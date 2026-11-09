-- Two indexes for reads that run often (2026-11-09, approved by the user):
--   coach_plan_meal_items (user_id, plan_id): every Coach tab visit, chat message and Macro visit
--     reads the active plan's foods by plan and member (activeCoachPlan in coach/plan.js)
--   ai_usage (user_id, created_at): before every AI call, the member's calls today are counted
--     (ai/limits.js)
-- Additive only, nothing is changed or deleted; safe to run more than once (each step checks
-- first). Run by hand with an account allowed to alter tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-20-coach-ai-indexes.sql

SET @has_meal_items_plan := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coach_plan_meal_items' AND INDEX_NAME = 'idx_coach_plan_meal_items_plan'
);
SET @add_meal_items_plan := IF(@has_meal_items_plan = 0, 'ALTER TABLE coach_plan_meal_items ADD INDEX idx_coach_plan_meal_items_plan (user_id, plan_id)', 'SELECT 1');
PREPARE add_meal_items_plan FROM @add_meal_items_plan;
EXECUTE add_meal_items_plan;
DEALLOCATE PREPARE add_meal_items_plan;

SET @has_ai_usage_user_time := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_usage' AND INDEX_NAME = 'idx_ai_usage_user_time'
);
SET @add_ai_usage_user_time := IF(@has_ai_usage_user_time = 0, 'ALTER TABLE ai_usage ADD INDEX idx_ai_usage_user_time (user_id, created_at)', 'SELECT 1');
PREPARE add_ai_usage_user_time FROM @add_ai_usage_user_time;
EXECUTE add_ai_usage_user_time;
DEALLOCATE PREPARE add_ai_usage_user_time;
