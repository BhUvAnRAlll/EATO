-- The AI Coach intake: one row of answers per member. Approved by the user on 2026-10-26 (Phase 1,
-- intake only). Safe to run more than once. Run after 2026-10-29-gym-assistant-questions.sql, by
-- hand, with an account allowed to create tables (eato_app can't), for example:
--   mysql -u root -p eato < migrations/2026-10-30-coach-intake.sql

-- One row per member: their AI coach intake answers (goal, schedule, where they train, what to
-- work around, food habits, the coach they picked). Read by the coach on the server only. The
-- member's account going takes the row with it.
CREATE TABLE IF NOT EXISTS coach_profiles (
  user_id                 VARCHAR(64)       NOT NULL,
  goal                    ENUM('build_muscle', 'lose_weight', 'get_stronger', 'endurance', 'stay_active', 'flexibility', 'sport', 'comeback') NOT NULL,
  experience              ENUM('beginner', 'returning', 'intermediate', 'advanced', 'expert') NOT NULL,
  currently_training      BOOLEAN           NOT NULL,
  weekdays                JSON              NOT NULL,  -- training days, 0 = Sunday (as workout_profiles)
  session_minutes         TINYINT UNSIGNED  NOT NULL,
  main_spot               ENUM('gym', 'home', 'outdoors', 'travel', 'other') NOT NULL,
  backup_spot             ENUM('gym', 'home', 'outdoors', 'travel', 'other') NULL,
  main_equipment          ENUM('none', 'some', 'home_gym', 'full_gym', 'basic_gym', 'free_weights') NOT NULL,
  backup_equipment        ENUM('none', 'some', 'home_gym', 'full_gym', 'basic_gym', 'free_weights') NULL,
  joints                  JSON              NOT NULL,  -- joints to protect, e.g. ["knees"]
  conditions              JSON              NOT NULL,  -- e.g. ["diabetes"]; any one makes the coach cautious
  limitation_notes        VARCHAR(300)      NULL,
  cooking_time            ENUM('none', 'quick', 'medium', 'long') NOT NULL,
  food_budget             ENUM('low', 'medium', 'high') NOT NULL,
  stress                  ENUM('low', 'moderate', 'high') NULL,
  sleep                   ENUM('under_5', '5_6', '7_8', 'over_8') NULL,
  coach                   ENUM('arjun', 'priya', 'rohan', 'meera', 'aditya') NOT NULL,
  coach_style             ENUM('supportive', 'motivational', 'direct', 'analytical', 'funny') NOT NULL,
  plan_notes              VARCHAR(500)      NULL,
  disclaimer_accepted_at  TIMESTAMP         NOT NULL,  -- "Fitness guidance, not medical advice"
  created_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_coach_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_coach_profiles_minutes CHECK (session_minutes IN (15, 20, 30, 45, 60, 75))
) ENGINE = InnoDB;
