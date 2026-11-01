-- The Fitness tab's programs (asked for by the user on 2026-11-02): free programs in six sections
-- (Popular, Categories, Build Muscle, Stay Fit, Dance, Workplace Wellness), for home, the center
-- or both, each made of sessions of library exercises. The admin manages them (Admin › Programs)
-- and can have the AI rewrite a program's sessions. In order:
--   1. fitness_programs, fitness_program_sessions, fitness_program_exercises (no cascades: the
--      server deletes children itself; nested ON DELETE CASCADE is unreliable on MySQL 9.7)
--   2. workout_days gets `program_session_id`: a program session done today runs as a day of the
--      member's plan, and the one-per-weekday key counts it apart from the plan's own days
--   3. workout_profiles gets `home_equipment` and `center_equipment` (the Fitness tab's location
--      sheet: what the member has at home and at their center)
--   4. ai_usage accepts the new AI feature `fitness_program`, and admin_audit_log the target `program`
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-08-workout-place.sql, by hand, with an account allowed to create and alter tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-09-fitness-programs.sql
-- The starter programs are added by the server the first time the Fitness tab opens.

-- 1. The programs
CREATE TABLE IF NOT EXISTS fitness_programs (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  slug         VARCHAR(60)       NOT NULL,
  title        VARCHAR(60)       NOT NULL,
  subtitle     VARCHAR(120)      NOT NULL DEFAULT '',
  description  VARCHAR(600)      NOT NULL DEFAULT '',
  section      ENUM('popular', 'categories', 'build_muscle', 'stay_fit', 'dance', 'workplace') NOT NULL,
  place        ENUM('home', 'center', 'both') NOT NULL DEFAULT 'both',
  level        ENUM('beginner', 'intermediate', 'advanced') NOT NULL DEFAULT 'beginner',
  kit          ENUM('none', 'some', 'full_gym') NOT NULL DEFAULT 'none',
  icon         VARCHAR(20)       NOT NULL DEFAULT 'strength',
  palette      VARCHAR(20)       NOT NULL DEFAULT 'lavender',
  position     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  published    BOOLEAN           NOT NULL DEFAULT TRUE,
  built_in     BOOLEAN           NOT NULL DEFAULT FALSE,
  ai_drafted   BOOLEAN           NOT NULL DEFAULT FALSE,
  created_by   VARCHAR(64)       NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fitness_programs_slug (slug),
  KEY idx_fitness_programs_section (section, position),
  CONSTRAINT fk_fitness_programs_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS fitness_program_sessions (
  id          CHAR(36)          NOT NULL DEFAULT (UUID()),
  program_id  CHAR(36)          NOT NULL,
  position    TINYINT UNSIGNED  NOT NULL,
  title       VARCHAR(60)       NOT NULL,
  minutes     SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fitness_sessions_order (program_id, position),
  CONSTRAINT fk_fitness_sessions_program FOREIGN KEY (program_id) REFERENCES fitness_programs (id),
  CONSTRAINT chk_fitness_sessions_minutes CHECK (minutes BETWEEN 5 AND 180)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS fitness_program_exercises (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  session_id   CHAR(36)          NOT NULL,
  program_id   CHAR(36)          NOT NULL,
  exercise_id  CHAR(36)          NOT NULL,
  section      ENUM('warmup', 'workout', 'cooldown') NOT NULL,
  position     TINYINT UNSIGNED  NOT NULL,
  sets         JSON              NOT NULL,
  rest_sec     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  role         ENUM('main', 'secondary', 'isolation', 'conditioning', 'warmup', 'stretch') NULL,
  reps_min     TINYINT UNSIGNED  NULL,
  reps_max     TINYINT UNSIGNED  NULL,
  note         VARCHAR(160)      NULL,
  PRIMARY KEY (id),
  KEY idx_fitness_exercises_session (session_id, position),
  KEY idx_fitness_exercises_program (program_id),
  CONSTRAINT fk_fitness_exercises_session FOREIGN KEY (session_id) REFERENCES fitness_program_sessions (id),
  CONSTRAINT fk_fitness_exercises_exercise FOREIGN KEY (exercise_id) REFERENCES workout_exercise_library (id),
  CONSTRAINT chk_fitness_exercises_rest CHECK (rest_sec <= 600)
) ENGINE = InnoDB;

-- 2. A program session as a day of the member's plan
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_days' AND COLUMN_NAME = 'program_session_id'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE workout_days ADD COLUMN program_session_id CHAR(36) NULL AFTER place, MODIFY COLUMN place_key VARCHAR(36) AS (COALESCE(place, program_session_id, ''plan'')) STORED', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. What the member has at home and at their center
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_profiles' AND COLUMN_NAME = 'home_equipment'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE workout_profiles ADD COLUMN home_equipment ENUM(''none'', ''some'', ''home_gym'') NULL, ADD COLUMN center_equipment ENUM(''free_weights'', ''basic_gym'', ''full_gym'') NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. The new AI feature (the list as schema.sql has it)
ALTER TABLE ai_usage MODIFY COLUMN feature
  ENUM('gym_assistant', 'coach_plan', 'coach_workout', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report', 'exercise_library', 'workout_place', 'fitness_program') NOT NULL;

ALTER TABLE admin_audit_log MODIFY COLUMN target_type
  ENUM('user', 'gym', 'post', 'report', 'promotion', 'exercise', 'program') NOT NULL;
