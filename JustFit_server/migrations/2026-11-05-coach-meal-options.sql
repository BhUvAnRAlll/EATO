-- Swap Meal (2026-11-01): the options the coach offers for one meal of the plan, personal to the
-- member and the day, and a snapshot of the meal each one replaced (so Undo can put it back).
-- "Replace" only ever points at a row here, so nothing the app sends reaches the plan unchecked.
-- Additive only, safe to run more than once. Run after 2026-10-31-coach-plans.sql, by hand, with
-- an account allowed to create tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-05-coach-meal-options.sql
--
-- Structural links (plan_id, meal_id) are not foreign keys, as in the other coach tables: only
-- user_id cascades (see the cascade note in schema.sql), and every query filters on user_id too.
CREATE TABLE IF NOT EXISTS coach_meal_options (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id      VARCHAR(64)       NOT NULL,
  plan_id      CHAR(36)          NOT NULL,
  meal_id      CHAR(36)          NOT NULL,
  slot         ENUM('breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner') NOT NULL,
  kind         ENUM('suggestion', 'previous') NOT NULL DEFAULT 'suggestion',  -- an option offered, or the meal a replacement pushed out
  name         VARCHAR(120)      NOT NULL,
  description  VARCHAR(200)      NULL,      -- one line on why it fits (suggestions only)
  note         VARCHAR(300)      NULL,      -- the coach's tip
  items        JSON              NOT NULL,  -- the foods with portions and numbers, cleaned
  kcal         DECIMAL(6,1)      NOT NULL,
  protein_g    DECIMAL(6,1)      NOT NULL,
  carbs_g      DECIMAL(6,1)      NOT NULL,
  fat_g        DECIMAL(6,1)      NOT NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at      TIMESTAMP         NULL,      -- when it went into the plan
  PRIMARY KEY (id),
  KEY idx_coach_meal_options_meal (user_id, meal_id, created_at),
  KEY idx_coach_meal_options_slot (user_id, slot, created_at),
  CONSTRAINT fk_coach_meal_options_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_coach_meal_options_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_coach_meal_options_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;
