-- Trainers: trainer profiles, client connections, target recommendations and diet plans, plus
-- diet-plan logging in the Macro diary (macro_meal_logs gains the 'plan' source and a key that
-- makes logging a plan meal idempotent). Adds to an existing database; safe to run more than
-- once. schema.sql has all of this for a fresh install. Needs 2026-10-18-macro.sql first. Run
-- by hand with an account allowed to create and alter tables (eato_app can't), e.g.:
--   mysql -u root -p eato < migrations/2026-10-21-trainers.sql

ALTER TABLE macro_meal_logs
  MODIFY source ENUM('manual', 'favorite', 'repeat', 'plan') NOT NULL DEFAULT 'manual';

-- plan_log_key (MySQL has no ADD COLUMN IF NOT EXISTS, so the column is checked first)
SET @has_plan_log_key := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'macro_meal_logs' AND COLUMN_NAME = 'plan_log_key'
);
SET @add_plan_log_key := IF(
  @has_plan_log_key = 0,
  'ALTER TABLE macro_meal_logs ADD COLUMN plan_log_key VARCHAR(80) NULL AFTER source, ADD UNIQUE KEY uq_meal_logs_plan_key (user_id, plan_log_key)',
  'SELECT 1'
);
PREPARE add_plan_log_key FROM @add_plan_log_key;
EXECUTE add_plan_log_key;
DEALLOCATE PREPARE add_plan_log_key;

-- workout_plans.trainer_note: the trainer's note to the member (2026-10-19-workout.sql first)
SET @has_trainer_note := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_plans' AND COLUMN_NAME = 'trainer_note'
);
SET @add_trainer_note := IF(
  @has_trainer_note = 0,
  'ALTER TABLE workout_plans ADD COLUMN trainer_note VARCHAR(300) NULL AFTER created_by',
  'SELECT 1'
);
PREPARE add_trainer_note FROM @add_trainer_note;
EXECUTE add_trainer_note;
DEALLOCATE PREPARE add_trainer_note;

CREATE TABLE IF NOT EXISTS trainer_profiles (
  user_id           VARCHAR(64)   NOT NULL,
  title             VARCHAR(80)   NOT NULL,          -- e.g. "Strength coach"
  specialties       JSON          NOT NULL,          -- ["weight_loss", "muscle_gain", "nutrition", "strength", "yoga"]
  years_experience  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bio               VARCHAR(300)  NOT NULL,
  coaching_mode     ENUM('online', 'in_person', 'both') NOT NULL DEFAULT 'online',
  offers_nutrition  BOOLEAN       NOT NULL DEFAULT FALSE,
  accepting_clients BOOLEAN       NOT NULL DEFAULT TRUE,
  availability      VARCHAR(120)  NULL,              -- "Mon–Sat, 6–10am"
  approach          VARCHAR(1000) NULL,              -- shown after acceptance
  qualifications    JSON          NULL,              -- ["ACE CPT", ...], shown after acceptance
  languages         JSON          NULL,              -- ["English", "Kannada"], shown after acceptance
  photo_media_id    CHAR(36)      NULL,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_trainer_profiles_accepting (accepting_clients, title),
  CONSTRAINT fk_trainer_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_profiles_photo FOREIGN KEY (photo_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT chk_trainer_profiles_years CHECK (years_experience <= 60)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS trainer_connections (
  id            CHAR(36)    NOT NULL DEFAULT (UUID()),
  trainer_id    VARCHAR(64) NOT NULL,
  client_id     VARCHAR(64) NOT NULL,
  status        ENUM('requested', 'connected', 'declined', 'cancelled', 'ended') NOT NULL DEFAULT 'requested',
  ended_by      VARCHAR(64) NULL,                    -- who ended or declined it
  requested_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at  TIMESTAMP   NULL,
  ended_at      TIMESTAMP   NULL,
  open_client   VARCHAR(64) AS (IF(status IN ('requested', 'connected'), client_id, NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trainer_connections_open (open_client),
  KEY idx_trainer_connections_trainer (trainer_id, status, requested_at),
  KEY idx_trainer_connections_client (client_id, status),
  CONSTRAINT fk_trainer_connections_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_connections_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_trainer_connections_self CHECK (trainer_id <> client_id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS trainer_target_recommendations (
  id            CHAR(36)          NOT NULL DEFAULT (UUID()),
  trainer_id    VARCHAR(64)       NOT NULL,
  client_id     VARCHAR(64)       NOT NULL,
  calories      SMALLINT UNSIGNED NOT NULL,
  protein_g     SMALLINT UNSIGNED NOT NULL,
  carbs_g       SMALLINT UNSIGNED NOT NULL,
  fat_g         SMALLINT UNSIGNED NOT NULL,
  note          VARCHAR(300)      NULL,
  applied_at    TIMESTAMP         NULL,
  prior_target  JSON              NULL,              -- the client's active target when they applied this one
  created_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trainer_recs_client (client_id, created_at),
  CONSTRAINT fk_trainer_recs_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_recs_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_trainer_recs_calories CHECK (calories BETWEEN 800 AND 6000),
  CONSTRAINT chk_trainer_recs_macros CHECK (protein_g <= 600 AND carbs_g <= 900 AND fat_g <= 600)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS diet_plans (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  trainer_id     VARCHAR(64)  NOT NULL,
  client_id      VARCHAR(64)  NOT NULL,
  name           VARCHAR(80)  NOT NULL,
  goal           ENUM('fat_loss', 'muscle_gain', 'maintenance') NOT NULL,
  start_date     DATE         NOT NULL,
  end_date       DATE         NULL,
  notes          VARCHAR(1000) NULL,
  status         ENUM('active', 'superseded') NOT NULL DEFAULT 'active',
  active_client  VARCHAR(64)  AS (IF(status = 'active', client_id, NULL)) VIRTUAL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_diet_plans_one_active (active_client),
  KEY idx_diet_plans_client (client_id, status),
  KEY idx_diet_plans_trainer (trainer_id),
  CONSTRAINT fk_diet_plans_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_diet_plans_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS diet_plan_meals (
  id         CHAR(36)         NOT NULL DEFAULT (UUID()),
  plan_id    CHAR(36)         NOT NULL,
  client_id  VARCHAR(64)      NOT NULL,
  slot       ENUM('breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner') NOT NULL,
  name       VARCHAR(120)     NOT NULL,
  meal_time  TIME             NOT NULL,
  note       VARCHAR(300)     NULL,
  position   TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_diet_plan_meals_slot (plan_id, slot),
  KEY idx_diet_plan_meals_plan (plan_id, position),
  KEY idx_diet_plan_meals_client (client_id),
  CONSTRAINT fk_diet_plan_meals_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS diet_plan_meal_items (
  id         CHAR(36)          NOT NULL DEFAULT (UUID()),
  meal_id    CHAR(36)          NOT NULL,
  client_id  VARCHAR(64)       NOT NULL,
  position   TINYINT UNSIGNED  NOT NULL,
  name       VARCHAR(120)      NOT NULL,
  quantity   DECIMAL(7,2)      NOT NULL,
  unit       VARCHAR(40)       NOT NULL,
  kcal       DECIMAL(6,1)      NOT NULL,
  protein_g  DECIMAL(6,1)      NOT NULL,
  carbs_g    DECIMAL(6,1)      NOT NULL,
  fat_g      DECIMAL(6,1)      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_diet_plan_meal_items_meal (meal_id, position),
  KEY idx_diet_plan_meal_items_client (client_id),
  CONSTRAINT fk_diet_plan_meal_items_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_diet_plan_meal_items_quantity CHECK (quantity > 0 AND quantity <= 10000),
  CONSTRAINT chk_diet_plan_meal_items_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_diet_plan_meal_items_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS diet_plan_completions (
  client_id  VARCHAR(64) NOT NULL,
  meal_id    CHAR(36)    NOT NULL,
  done_date  DATE        NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, meal_id, done_date),
  CONSTRAINT fk_diet_plan_completions_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
