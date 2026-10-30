-- Removes the trainer module for good (approved by the user on 2026-10-29): the platform
-- "trainer" role, trainer profiles and coaching (connections, diet plans, target
-- recommendations), and the "trainer" rank inside gyms. In order:
--   1. members on a trainer's target get their own back: the target they had when they
--      applied the trainer's (saved on the recommendation), else the calculated one; with
--      neither, the trainer's numbers stay as the member's own adjusted target
--   2. a trainer-written workout plan stops being active (the app makes an engine plan again
--      on the next visit); old trainer plans are kept as history, marked as engine plans, and
--      workout_plans loses created_by and trainer_note
--   3. trainer accounts become members ('user'); gym trainers become gym members; pending
--      trainer invitations become member invitations; a gym setting of "trainers" becomes the
--      choice that allows the same people now (posting and events: admins; comments: off,
--      which already means only admins)
--   4. the "trainer" values leave the ENUMs, and the eight trainer tables are dropped
-- Logged meals stay in the Macro diary (source 'plan'), and messages between a former trainer
-- and client stay readable (sending needs a friendship again). Trainer profile photos become
-- unattached uploads, which the orphan sweep removes.
--
-- Safe to run more than once: each step checks first. Run after 2026-11-01-phone-auth.sql, by
-- hand, with an account allowed to alter and drop tables (eato_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p eato < migrations/2026-11-02-remove-trainers.sql
-- This deletes data and can't be undone: back up the database first.

-- 1. Targets: back to the member's own (only while the recommendations table still exists)
SET @has_recs := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trainer_target_recommendations'
);
SET @restore_saved := IF(@has_recs = 1,
  'UPDATE nutrition_targets t
   JOIN (
     SELECT client_id, prior_target,
            ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY applied_at DESC, id DESC) AS n
     FROM trainer_target_recommendations
     WHERE applied_at IS NOT NULL AND prior_target IS NOT NULL
   ) r ON r.client_id = t.user_id AND r.n = 1
   SET t.calories  = JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.calories'')),
       t.protein_g = JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.macros.proteinG'')),
       t.carbs_g   = JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.macros.carbsG'')),
       t.fat_g     = JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.macros.fatG'')),
       t.source    = JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.source'')),
       t.reason    = JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.reason'')),
       t.set_by    = IF(JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.source'')) = ''calculated'', NULL, t.user_id)
   WHERE t.source = ''trainer_adjusted''
     AND JSON_UNQUOTE(JSON_EXTRACT(r.prior_target, ''$.source'')) IN (''calculated'', ''user_adjusted'')',
  'SELECT 1');
PREPARE restore_saved FROM @restore_saved;
EXECUTE restore_saved;
DEALLOCATE PREPARE restore_saved;

-- Nothing saved: the calculated target
UPDATE nutrition_targets
SET calories  = JSON_EXTRACT(calculated, '$.displayCalories'),
    protein_g = JSON_EXTRACT(calculated, '$.macros.proteinG'),
    carbs_g   = JSON_EXTRACT(calculated, '$.macros.carbsG'),
    fat_g     = JSON_EXTRACT(calculated, '$.macros.fatG'),
    source    = 'calculated',
    reason    = NULL,
    set_by    = NULL
WHERE source = 'trainer_adjusted' AND calculated IS NOT NULL;

-- No calculation either: the trainer's numbers stay, as the member's own target
UPDATE nutrition_targets
SET source = 'user_adjusted', reason = 'Kept from your former trainer''s target', set_by = user_id
WHERE source = 'trainer_adjusted';

-- 2. Trainer-written workout plans
UPDATE workout_plans SET status = 'superseded' WHERE source = 'trainer' AND status = 'active';
UPDATE workout_plans SET source = 'engine' WHERE source = 'trainer';

SET @has_creator_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_plans' AND INDEX_NAME = 'idx_workout_plans_creator'
);
SET @drop_creator_index := IF(@has_creator_index > 0, 'ALTER TABLE workout_plans DROP INDEX idx_workout_plans_creator', 'SELECT 1');
PREPARE drop_creator_index FROM @drop_creator_index;
EXECUTE drop_creator_index;
DEALLOCATE PREPARE drop_creator_index;

SET @has_created_by := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_plans' AND COLUMN_NAME = 'created_by'
);
SET @drop_created_by := IF(@has_created_by = 1, 'ALTER TABLE workout_plans DROP COLUMN created_by', 'SELECT 1');
PREPARE drop_created_by FROM @drop_created_by;
EXECUTE drop_created_by;
DEALLOCATE PREPARE drop_created_by;

SET @has_trainer_note := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_plans' AND COLUMN_NAME = 'trainer_note'
);
SET @drop_trainer_note := IF(@has_trainer_note = 1, 'ALTER TABLE workout_plans DROP COLUMN trainer_note', 'SELECT 1');
PREPARE drop_trainer_note FROM @drop_trainer_note;
EXECUTE drop_trainer_note;
DEALLOCATE PREPARE drop_trainer_note;

-- 3. Roles and gym settings
UPDATE users SET role = 'user' WHERE role = 'trainer';
UPDATE gym_members SET role = 'member' WHERE role = 'trainer';
UPDATE gym_invitations SET role = 'member' WHERE role = 'trainer';
UPDATE gyms SET who_can_post = 'admins' WHERE who_can_post = 'trainers';
UPDATE gyms SET who_can_comment = 'off' WHERE who_can_comment = 'trainers';
UPDATE gyms SET who_can_create_events = 'admins' WHERE who_can_create_events = 'trainers';

-- 4. The ENUMs (re-running them is harmless), then the trainer tables, children first
ALTER TABLE users MODIFY role ENUM('user', 'admin') NOT NULL DEFAULT 'user';
ALTER TABLE gym_members MODIFY role ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member';
ALTER TABLE gym_invitations MODIFY role ENUM('member') NOT NULL DEFAULT 'member';
ALTER TABLE gyms
  MODIFY who_can_post ENUM('everyone', 'admins') NOT NULL DEFAULT 'everyone',
  MODIFY who_can_comment ENUM('members', 'off') NOT NULL DEFAULT 'members',
  MODIFY who_can_create_events ENUM('admins', 'members') NOT NULL DEFAULT 'admins';
ALTER TABLE nutrition_targets MODIFY source ENUM('calculated', 'user_adjusted') NOT NULL DEFAULT 'calculated';
ALTER TABLE workout_plans MODIFY source ENUM('engine', 'member') NOT NULL DEFAULT 'engine';

DROP TABLE IF EXISTS diet_plan_completions;
DROP TABLE IF EXISTS diet_plan_meal_items;
DROP TABLE IF EXISTS diet_plan_meals;
DROP TABLE IF EXISTS diet_plans;
DROP TABLE IF EXISTS trainer_target_recommendations;
DROP TABLE IF EXISTS trainer_connections;
DROP TABLE IF EXISTS trainer_profiles;
DROP TABLE IF EXISTS trainer_clients;
