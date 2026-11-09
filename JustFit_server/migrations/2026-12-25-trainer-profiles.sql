-- Gym Profile Management, phase 3 (approved by the user on 2026-11-09): public profiles for a gym's
-- trainers. Only trainer logins have one (the user's choice): the people a gym admin added as
-- Trainer under Staff / Admin Login. One profile per trainer per gym (brand); it shows at every
-- branch the trainer works at (gym_staff), while the gym switches it on. Members see the name from
-- the trainer's account, the photo, specialisations, years of experience, certifications, a short
-- bio and when they're available.
--
-- Creates one table; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-25-trainer-profiles.sql

CREATE TABLE IF NOT EXISTS gym_trainer_profiles (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,  -- the id members see (never the account's)
  brand_id          INT UNSIGNED NOT NULL,
  user_id           VARCHAR(64)  NOT NULL,                 -- the trainer's justFit account
  photo_key         VARCHAR(64)  NULL,                     -- a file name in TRAINER_PHOTO_DIR
  specializations   JSON         NULL,                     -- ["Strength", "Weight loss"]
  years_experience  TINYINT UNSIGNED NULL,
  certifications    JSON         NULL,                     -- ["ACE CPT", "K11 Diploma"]
  bio               VARCHAR(500) NULL,
  availability      JSON         NULL,                     -- { mon: [["06:00","10:00"]], …, sun: [] }; NULL: not given
  active            TINYINT(1)   NOT NULL DEFAULT 0,       -- shown to members
  updated_by        VARCHAR(64)  NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_trainer_profiles (brand_id, user_id),
  KEY idx_gym_trainer_profiles_user (user_id),
  CONSTRAINT fk_gym_trainer_profiles_brand FOREIGN KEY (brand_id) REFERENCES gym_brands (id),
  CONSTRAINT fk_gym_trainer_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_trainer_profiles_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_trainer_years CHECK (years_experience IS NULL OR years_experience <= 60)
) ENGINE = InnoDB;
