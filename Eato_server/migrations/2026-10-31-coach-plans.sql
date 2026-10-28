-- The AI Coach plan: the coach's day of meals and the note that goes with it. Approved by the
-- user on 2026-10-27 (Phase 2: workout from the existing engine, a new table set for the diet,
-- a human trainer's plan wins). Safe to run more than once. Run after 2026-10-30-coach-intake.sql,
-- by hand, with an account allowed to create tables (eato_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p eato < migrations/2026-10-31-coach-plans.sql
--
-- Structural links (plan_id, meal_id, workout_plan_id) are not foreign keys, as in the Workout
-- tables: only user_id cascades (see the cascade note in schema.sql), and every query filters on
-- user_id as well.

-- One active coach plan per member (older ones are kept as superseded). The targets are the
-- member's nutrition targets when the plan was made; the workout itself lives in workout_plans.
CREATE TABLE IF NOT EXISTS coach_plans (
  id               CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id          VARCHAR(64)       NOT NULL,
  coach            ENUM('arjun', 'priya', 'rohan', 'meera', 'aditya') NOT NULL,
  message          VARCHAR(1000)     NOT NULL,  -- the coach's note about the plan
  workout_plan_id  CHAR(36)          NULL,      -- the workout_plans row made with it
  calories         SMALLINT UNSIGNED NOT NULL,
  protein_g        SMALLINT UNSIGNED NOT NULL,
  carbs_g          SMALLINT UNSIGNED NOT NULL,
  fat_g            SMALLINT UNSIGNED NOT NULL,
  status           ENUM('active', 'superseded') NOT NULL DEFAULT 'active',
  active_user      VARCHAR(64)       AS (IF(status = 'active', user_id, NULL)) VIRTUAL,
  created_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coach_plans_one_active (active_user),
  KEY idx_coach_plans_user (user_id, status),
  CONSTRAINT fk_coach_plans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The plan's five meals (the same slots as a trainer's diet plan)
CREATE TABLE IF NOT EXISTS coach_plan_meals (
  id         CHAR(36)         NOT NULL DEFAULT (UUID()),
  plan_id    CHAR(36)         NOT NULL,
  user_id    VARCHAR(64)      NOT NULL,
  slot       ENUM('breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner') NOT NULL,
  name       VARCHAR(120)     NOT NULL,
  meal_time  TIME             NOT NULL,
  note       VARCHAR(300)     NULL,
  position   TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coach_plan_meals_slot (plan_id, slot),
  KEY idx_coach_plan_meals_user (user_id),
  CONSTRAINT fk_coach_plan_meals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The foods in each meal, with the portion and its calories and macros
CREATE TABLE IF NOT EXISTS coach_plan_meal_items (
  id         CHAR(36)          NOT NULL DEFAULT (UUID()),
  meal_id    CHAR(36)          NOT NULL,
  plan_id    CHAR(36)          NOT NULL,
  user_id    VARCHAR(64)       NOT NULL,
  position   TINYINT UNSIGNED  NOT NULL,
  name       VARCHAR(120)      NOT NULL,
  quantity   DECIMAL(7,2)      NOT NULL,
  unit       VARCHAR(40)       NOT NULL,
  kcal       DECIMAL(6,1)      NOT NULL,
  protein_g  DECIMAL(6,1)      NOT NULL,
  carbs_g    DECIMAL(6,1)      NOT NULL,
  fat_g      DECIMAL(6,1)      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_coach_plan_meal_items_meal (meal_id, position),
  KEY idx_coach_plan_meal_items_user (user_id),
  CONSTRAINT fk_coach_plan_meal_items_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_coach_plan_meal_items_quantity CHECK (quantity > 0 AND quantity <= 10000),
  CONSTRAINT chk_coach_plan_meal_items_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_coach_plan_meal_items_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;
