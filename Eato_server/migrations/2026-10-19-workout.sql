-- Workout: the exercise library, each member's workout answers, generated plans with
-- their days and exercises, per-date overrides (move/swap), session logs and set logs.
-- Eight new tables, nothing else changes; the setup profile (profiles) is not touched.
-- Safe to run more than once (every table is created only if it is missing). schema.sql
-- already has these for a fresh install. Needs the community tables first
-- (2026-10-14-community.sql: thumbnails reference community_media). Run by hand with an
-- account allowed to create tables, for example:
--   mysql -u root -p eato < migrations/2026-10-19-workout.sql

-- ---------------------------------------------------------------------------
-- Workout: generated training plans, what members actually did, and the exercise
-- library behind them. Plans come from the engine in Eato_client/src/lib/workout
-- (deterministic arithmetic, no AI). Every member row is only read or changed by
-- that member; library rows are written by admins only.
--
-- Every member row hangs directly off users. Deleting a member must remove every workout
-- row of theirs, and MySQL 9.7.0 (InnoDB) gets a deeper chain wrong: with users > plans >
-- days > exercises and two or more plans, only the first plan's days and exercises are
-- cascaded; the rest are orphaned (reproduced on plain three-level tables, see
-- __tests__/e2e/workout-schema.e2e.test.js). So the only ON DELETE CASCADE in these tables is
-- user_id > users, one level deep. The structural links (plan_id, day_id, log_id,
-- day_exercise_id, created_by) are indexed columns the server fills from the parent row and
-- checks on every write, not foreign keys; plans are superseded, never deleted on their own.
-- ---------------------------------------------------------------------------

-- The exercise library. Built-in rows are kept in step with Eato_client/src/lib/workout/
-- library.ts by name; admins add their own. A row is archived, never deleted, so plans
-- that already use it keep resolving. Names are unique case-insensitively (the default
-- collation), and the engine fields are required: a row it cannot place is never programmed.
CREATE TABLE IF NOT EXISTS workout_exercise_library (
  id                  CHAR(36)          NOT NULL DEFAULT (UUID()),
  name                VARCHAR(80)       NOT NULL,
  muscle_group        ENUM('legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'full_body', 'cardio') NOT NULL,
  equipment           VARCHAR(60)       NULL,
  pattern             ENUM('squat', 'hinge', 'lunge', 'knee_flexion', 'knee_extension', 'calf',
                           'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
                           'elbow_flexion', 'elbow_extension', 'shoulder_abduction', 'rear_delt',
                           'core', 'conditioning', 'warmup', 'stretch') NOT NULL,
  difficulty          TINYINT UNSIGNED  NOT NULL,     -- 1-3: complexity, stability, skill, loading (not effort)
  high_risk           BOOLEAN           NOT NULL DEFAULT FALSE,
  low_impact          BOOLEAN           NOT NULL DEFAULT TRUE,
  machine             BOOLEAN           NOT NULL DEFAULT FALSE,
  region              ENUM('lower', 'upper', 'any') NOT NULL DEFAULT 'any',
  timed_sec           SMALLINT UNSIGNED NULL,         -- held or timed work: the base seconds
  instructions        JSON              NULL,         -- up to 10 lines of up to 200 characters
  thumbnail_media_id  CHAR(36)          NULL,
  video_media_id      CHAR(36)          NULL,         -- demo clips: not uploaded yet (video support is deferred)
  built_in            BOOLEAN           NOT NULL DEFAULT FALSE,
  created_by          VARCHAR(64)       NULL,         -- set on admin-authored rows only
  archived_at         TIMESTAMP         NULL,
  created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_library_name (name),
  KEY idx_workout_library_group (muscle_group, name),
  KEY idx_workout_library_pattern (pattern, difficulty),
  CONSTRAINT fk_workout_library_thumbnail FOREIGN KEY (thumbnail_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_workout_library_video FOREIGN KEY (video_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_workout_library_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_workout_library_difficulty CHECK (difficulty BETWEEN 1 AND 3),
  CONSTRAINT chk_workout_library_timed CHECK (timed_sec IS NULL OR timed_sec BETWEEN 1 AND 3600)
) ENGINE = InnoDB;

-- The answers the engine reads, one row per member: what Preferences and "Rebuild my
-- plan" saved. Each one is NULL until asked. They shape training only: the setup profile
-- (profiles) stays the source for nutrition and is never written by the workout feature.
CREATE TABLE IF NOT EXISTS workout_profiles (
  user_id         VARCHAR(64)       NOT NULL,
  gender          ENUM('female', 'male', 'other') NULL,
  age_years       TINYINT UNSIGNED  NULL,
  weight_kg       DECIMAL(4,1)      NULL,
  height_cm       SMALLINT UNSIGNED NULL,
  body_type       ENUM('lean', 'athletic', 'average', 'overweight', 'obese') NULL,
  goal            ENUM('lose_weight', 'build_muscle', 'get_fitter', 'stay_healthy') NULL,
  experience      ENUM('beginner', 'intermediate', 'advanced') NULL,
  weekdays        JSON              NULL,             -- chosen training days, 0 = Sunday
  pace            ENUM('slow', 'standard', 'brisk') NULL,
  fitness_base    TINYINT UNSIGNED  NULL,
  squat_score     TINYINT UNSIGNED  NULL,
  push_score      TINYINT UNSIGNED  NULL,
  pull_score      TINYINT UNSIGNED  NULL,
  serious_injury  BOOLEAN           NULL,
  split           ENUM('auto', 'full_body', 'upper_lower', 'push_pull_legs') NULL,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_workout_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_profiles_age CHECK (age_years IS NULL OR age_years BETWEEN 13 AND 100),
  CONSTRAINT chk_workout_profiles_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 25 AND 300),
  CONSTRAINT chk_workout_profiles_height CHECK (height_cm IS NULL OR height_cm BETWEEN 100 AND 250),
  CONSTRAINT chk_workout_profiles_scores CHECK (
    (fitness_base IS NULL OR fitness_base BETWEEN 1 AND 4) AND (squat_score IS NULL OR squat_score BETWEEN 1 AND 4) AND
    (push_score IS NULL OR push_score BETWEEN 1 AND 4) AND (pull_score IS NULL OR pull_score BETWEEN 1 AND 4))
) ENGINE = InnoDB;

-- A member's weekly programme: a snapshot of one engine run, stamped with what produced it.
-- One active plan per member; a regenerated plan supersedes the old one, which is kept.
CREATE TABLE IF NOT EXISTS workout_plans (
  id                            CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id                       VARCHAR(64)       NOT NULL,
  name                          VARCHAR(80)       NOT NULL,
  goal                          ENUM('lose_weight', 'build_muscle', 'get_fitter', 'stay_healthy') NOT NULL,
  level                         ENUM('beginner', 'intermediate', 'advanced') NOT NULL,
  days_per_week                 TINYINT UNSIGNED  NOT NULL,
  split                         ENUM('auto', 'full_body', 'upper_lower', 'push_pull_legs') NOT NULL DEFAULT 'auto',
  source                        ENUM('engine', 'member', 'trainer') NOT NULL DEFAULT 'engine',
  created_by                    VARCHAR(64)       NULL,   -- the trainer, for trainer-written plans (none exist yet)
  status                        ENUM('active', 'superseded', 'archived') NOT NULL DEFAULT 'active',
  engine_version                SMALLINT UNSIGNED NULL,
  input_hash                    CHAR(8)           NULL,
  inputs_snapshot               JSON              NULL,
  calibration                   JSON              NULL,
  requires_professional_review  BOOLEAN           NOT NULL DEFAULT FALSE,
  start_date                    DATE              NULL,
  -- Equals user_id only while active, so a member can never have two active plans. Virtual
  -- (indexed, not stored): MySQL forbids ON DELETE CASCADE on the base of a stored column.
  active_user_id                VARCHAR(64)       AS (IF(status = 'active', user_id, NULL)) VIRTUAL,
  created_at                    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_plans_one_active (active_user_id),
  KEY idx_workout_plans_user_status (user_id, status),
  KEY idx_workout_plans_creator (created_by),
  CONSTRAINT fk_workout_plans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_plans_days CHECK (days_per_week BETWEEN 1 AND 7)
) ENGINE = InnoDB;

-- One training day of a plan, pinned to a weekday (0 = Sunday), not to a date
CREATE TABLE IF NOT EXISTS workout_days (
  id            CHAR(36)          NOT NULL DEFAULT (UUID()),
  plan_id       CHAR(36)          NOT NULL,
  user_id       VARCHAR(64)       NOT NULL,
  weekday       TINYINT UNSIGNED  NOT NULL,
  title         VARCHAR(60)       NOT NULL,
  session_type  VARCHAR(20)       NULL,             -- full_body, upper, lower, push, pull, legs
  created_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_days_plan_weekday (plan_id, weekday),
  KEY idx_workout_days_user (user_id),
  CONSTRAINT fk_workout_days_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_days_weekday CHECK (weekday BETWEEN 0 AND 6)
) ENGINE = InnoDB;

-- An exercise inside a day, with its prescribed sets and rest. `sets` is a JSON array of
-- { reps?, durationSec?, weightKg? }; the engine never sets weightKg. `note` carries the
-- engine's own explanation when it had to substitute.
CREATE TABLE IF NOT EXISTS workout_day_exercises (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  day_id       CHAR(36)          NOT NULL,
  plan_id      CHAR(36)          NOT NULL,
  user_id      VARCHAR(64)       NOT NULL,
  exercise_id  CHAR(36)          NOT NULL,
  section      ENUM('warmup', 'workout', 'cooldown') NOT NULL,
  position     TINYINT UNSIGNED  NOT NULL,
  sets         JSON              NOT NULL,
  rest_sec     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  role         ENUM('main', 'secondary', 'isolation', 'conditioning', 'warmup', 'stretch') NULL,
  reps_min     TINYINT UNSIGNED  NULL,
  reps_max     TINYINT UNSIGNED  NULL,
  note         VARCHAR(160)      NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workout_day_exercises_order (day_id, section, position),
  KEY idx_workout_day_exercises_plan (plan_id),
  KEY idx_workout_day_exercises_user (user_id),
  CONSTRAINT fk_workout_day_exercises_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_day_exercises_exercise FOREIGN KEY (exercise_id) REFERENCES workout_exercise_library (id),
  CONSTRAINT chk_workout_day_exercises_rest CHECK (rest_sec <= 600)
) ENGINE = InnoDB;

-- "On this date, run that day": all that moving a missed session or swapping two days writes
CREATE TABLE IF NOT EXISTS workout_day_overrides (
  user_id     VARCHAR(64)  NOT NULL,
  on_date     DATE         NOT NULL,                -- the member's local day
  day_id      CHAR(36)     NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, on_date),
  KEY idx_workout_overrides_day (day_id),
  CONSTRAINT fk_workout_overrides_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One attempt at a day: what happened, separate from the plan (the intention)
CREATE TABLE IF NOT EXISTS workout_logs (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id       VARCHAR(64)  NOT NULL,
  plan_id       CHAR(36)     NULL,
  day_id        CHAR(36)     NULL,
  on_date       DATE         NOT NULL,                -- the member's local day
  started_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at  TIMESTAMP(3) NULL,
  status        ENUM('in_progress', 'completed', 'abandoned') NOT NULL DEFAULT 'in_progress',
  -- Set only while in progress, so a member can never have two running logs for one date.
  -- Virtual for the same reason as workout_plans.active_user_id.
  running_key   VARCHAR(80)  AS (IF(status = 'in_progress', CONCAT(user_id, '|', on_date), NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_logs_running (running_key),
  KEY idx_workout_logs_user_date (user_id, on_date),
  KEY idx_workout_logs_day (day_id),
  CONSTRAINT fk_workout_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One completed set inside a log. Unique per (log, exercise, set), so redoing a set
-- replaces it rather than adding a second row.
CREATE TABLE IF NOT EXISTS workout_set_logs (
  id               CHAR(36)          NOT NULL DEFAULT (UUID()),
  log_id           CHAR(36)          NOT NULL,
  user_id          VARCHAR(64)       NOT NULL,
  day_exercise_id  CHAR(36)          NOT NULL,
  set_index        TINYINT UNSIGNED  NOT NULL,
  reps             SMALLINT UNSIGNED NULL,
  weight_kg        DECIMAL(5,1)      NULL,
  duration_sec     SMALLINT UNSIGNED NULL,
  completed_at     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_set_logs_set (log_id, day_exercise_id, set_index),
  KEY idx_workout_set_logs_exercise (day_exercise_id),
  KEY idx_workout_set_logs_user (user_id),
  CONSTRAINT fk_workout_set_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_set_logs_values CHECK (
    (reps IS NULL OR reps <= 1000) AND (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 1000)) AND
    (duration_sec IS NULL OR duration_sec <= 3600))
) ENGINE = InnoDB;
