-- Macro diary: logged meals and their foods, favourite foods, water entries, each day's
-- water target and the hydration reminder settings. Six new tables, nothing else changes.
-- Safe to run more than once (every table is created only if it is missing). schema.sql
-- already has these for a fresh install. Run by hand with an account allowed to create
-- tables, for example:
--   mysql -u root -p eato < migrations/2026-10-18-macro.sql

-- Macro diary: the meals and water a member logs for themselves. Separate from the
-- delivery menu (`meals`) and from `food_log` (kept for logging delivered orders).
-- Every row belongs to one member and is only ever read or changed by that member.

-- A logged meal. Its totals are always summed from its items, never stored here.
CREATE TABLE IF NOT EXISTS macro_meal_logs (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  log_date    DATE         NOT NULL,                  -- the member's local day
  slot        ENUM('breakfast', 'lunch', 'snack', 'dinner') NOT NULL,
  title       VARCHAR(120) NOT NULL,
  logged_at   TIMESTAMP(3) NOT NULL,                  -- when it was eaten; orders the day
  source      ENUM('manual', 'favorite', 'repeat') NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meal_logs_user_day (user_id, log_date, logged_at),
  KEY idx_meal_logs_user_recent (user_id, logged_at),
  CONSTRAINT fk_meal_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The foods inside a logged meal, in the order they were entered
CREATE TABLE IF NOT EXISTS macro_meal_items (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  macro_meal_id  CHAR(36)          NOT NULL,
  user_id      VARCHAR(64)       NOT NULL,
  position     TINYINT UNSIGNED  NOT NULL,
  name         VARCHAR(120)      NOT NULL,
  quantity     DECIMAL(7,2)      NOT NULL,
  unit         VARCHAR(40)       NOT NULL,
  kcal         DECIMAL(6,1)      NOT NULL,
  protein_g    DECIMAL(6,1)      NOT NULL,
  carbs_g      DECIMAL(6,1)      NOT NULL,
  fat_g        DECIMAL(6,1)      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_meal_log_items_meal (macro_meal_id, position),
  CONSTRAINT fk_meal_log_items_meal FOREIGN KEY (macro_meal_id) REFERENCES macro_meal_logs (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_log_items_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_meal_log_items_quantity CHECK (quantity > 0 AND quantity <= 10000),
  CONSTRAINT chk_meal_log_items_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_meal_log_items_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;

-- Foods a member hearted. `source_key` (e.g. "meal:<id>") makes the heart a toggle;
-- a favourite saved without one is always a new row (NULLs don't collide in a UNIQUE key).
CREATE TABLE IF NOT EXISTS macro_favorite_foods (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  name        VARCHAR(120) NOT NULL,
  items       JSON         NOT NULL,                  -- same shape as macro_meal_items
  source_key  VARCHAR(80)  NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_favorite_foods_source (user_id, source_key),
  KEY idx_favorite_foods_user (user_id, created_at),
  CONSTRAINT fk_favorite_foods_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One glass, bottle or custom amount of water
CREATE TABLE IF NOT EXISTS macro_water_logs (
  id          CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)       NOT NULL,
  log_date    DATE              NOT NULL,
  amount_ml   SMALLINT UNSIGNED NOT NULL,
  logged_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source      ENUM('quick_add', 'custom', 'workout') NOT NULL DEFAULT 'quick_add',
  label       VARCHAR(40)       NULL,
  PRIMARY KEY (id),
  KEY idx_water_logs_user_day (user_id, log_date, logged_at),
  CONSTRAINT fk_water_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_water_logs_amount CHECK (amount_ml BETWEEN 10 AND 3000)
) ENGINE = InnoDB;

-- A day's water target, written once on the first log of that day so it never shifts
-- afterwards (only a recorded workout changes it). consumed_ml is a cache of the entries.
CREATE TABLE IF NOT EXISTS macro_hydration_days (
  user_id                     VARCHAR(64)       NOT NULL,
  log_date                    DATE              NOT NULL,
  target_ml                   SMALLINT UNSIGNED NOT NULL,
  base_target_ml              SMALLINT UNSIGNED NOT NULL,
  activity_adjustment_ml      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  workout_adjustment_ml       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  environmental_adjustment_ml SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_ml                 INT UNSIGNED      NOT NULL DEFAULT 0,
  workout_minutes             SMALLINT UNSIGNED NULL,
  workout_intensity           ENUM('light', 'moderate', 'high') NULL,
  used_fallbacks              BOOLEAN           NOT NULL DEFAULT FALSE,
  calc_version                VARCHAR(20)       NOT NULL,
  updated_at                  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, log_date),
  CONSTRAINT fk_hydration_days_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Hydration reminder settings, one row per member (defaults: on, every 2 hours, 08:00–20:00)
CREATE TABLE IF NOT EXISTS macro_hydration_preferences (
  user_id            VARCHAR(64)      NOT NULL,
  reminders_enabled  BOOLEAN          NOT NULL DEFAULT TRUE,
  interval_hours     TINYINT UNSIGNED NOT NULL DEFAULT 2,
  start_hour         TINYINT UNSIGNED NOT NULL DEFAULT 8,
  end_hour           TINYINT UNSIGNED NOT NULL DEFAULT 20,
  updated_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_hydration_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_hydration_preferences_interval CHECK (interval_hours BETWEEN 1 AND 12),
  CONSTRAINT chk_hydration_preferences_window CHECK (start_hour <= 23 AND end_hour <= 23 AND end_hour > start_hour)
) ENGINE = InnoDB;
