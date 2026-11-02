-- Fitness categories (asked for by the user on 2026-11-02): the Fitness tab's sections become rows
-- the admin manages (Admin › Programs › Categories): create a category like a program, rename it,
-- change its note and card style, reorder it, show or hide it, and delete one they made while it
-- has no programs. The six built-in ones can't be deleted. In order:
--   1. fitness_sections, with the six built-in categories as they were
--   2. fitness_programs.section becomes a key of fitness_sections (no cascade: a category with
--      programs can't be deleted)
--   3. admin_audit_log accepts `section` as a target
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-12-program-covers.sql, by hand, with an account allowed to create and alter tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-13-fitness-categories.sql

-- 1. The categories
CREATE TABLE IF NOT EXISTS fitness_sections (
  slug         VARCHAR(40)       NOT NULL,
  title        VARCHAR(40)       NOT NULL,
  note         VARCHAR(120)      NOT NULL DEFAULT '',
  layout       ENUM('poster', 'tile', 'wide') NOT NULL DEFAULT 'tile',
  position     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  published    BOOLEAN           NOT NULL DEFAULT TRUE,
  built_in     BOOLEAN           NOT NULL DEFAULT FALSE,
  created_by   VARCHAR(64)       NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (slug),
  KEY idx_fitness_sections_position (position),
  CONSTRAINT fk_fitness_sections_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

INSERT IGNORE INTO fitness_sections (slug, title, note, layout, position, built_in) VALUES
  ('popular', 'Popular Programs', 'What members are doing right now', 'poster', 0, TRUE),
  ('categories', 'Fitness Categories', 'Start with what you enjoy', 'tile', 1, TRUE),
  ('build_muscle', 'Build Muscle', 'Get stronger, week by week', 'tile', 2, TRUE),
  ('stay_fit', 'Stay Fit', 'Keep your fitness up all year', 'tile', 3, TRUE),
  ('dance', 'Dance Fitness', 'Move to the music and burn calories', 'wide', 4, TRUE),
  ('workplace', 'Workplace Wellness', 'Short sessions for the workday, at your desk or with your team', 'wide', 5, TRUE);

-- 2. A program's category is a row of fitness_sections
SET @is_enum := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_programs' AND COLUMN_NAME = 'section' AND DATA_TYPE = 'enum'
);
SET @sql := IF(@is_enum = 1, 'ALTER TABLE fitness_programs MODIFY COLUMN section VARCHAR(40) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_programs' AND CONSTRAINT_NAME = 'fk_fitness_programs_section'
);
SET @sql := IF(@has_fk = 0, 'ALTER TABLE fitness_programs ADD CONSTRAINT fk_fitness_programs_section FOREIGN KEY (section) REFERENCES fitness_sections (slug) ON UPDATE RESTRICT ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. The new audit target (the list as schema.sql has it)
ALTER TABLE admin_audit_log MODIFY COLUMN target_type
  ENUM('user', 'gym', 'post', 'report', 'promotion', 'exercise', 'program', 'section') NOT NULL;
