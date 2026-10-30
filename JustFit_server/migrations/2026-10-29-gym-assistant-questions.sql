-- Questions the in-app gym assistant couldn't answer, kept for the gym's team, and the team's
-- replies (shown in the asker's chat and bell). Approved by the user on 2026-10-18. Safe to run more
-- than once. Run after 2026-10-27-gym-notices.sql, by hand, with an account allowed to create tables
-- (justfit_app can't), for example:
--   mysql -u root -p justfit < migrations/2026-10-29-gym-assistant-questions.sql

-- One row per question passed to the team. Gyms are never deleted (RESTRICT); the asker's account
-- going takes their questions with it; a staff account going leaves its replies.
CREATE TABLE IF NOT EXISTS gym_assistant_questions (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()),
  gym_id       CHAR(36)      NOT NULL,
  user_id      VARCHAR(64)   NOT NULL,                 -- who asked (the verified caller)
  question     VARCHAR(500)  NOT NULL,
  ai_reply     VARCHAR(1000) NULL,                     -- what the assistant told them at the time
  status       ENUM('open', 'answered', 'dismissed') NOT NULL DEFAULT 'open',
  answer       VARCHAR(1000) NULL,                     -- the team's reply
  answered_by  VARCHAR(64)   NULL,
  answered_at  TIMESTAMP     NULL,
  created_at   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_gym_questions_gym (gym_id, status, created_at),
  KEY idx_gym_questions_user (user_id, gym_id, created_at),
  CONSTRAINT fk_gym_questions_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gym_questions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_questions_answerer FOREIGN KEY (answered_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_questions_answer CHECK ((status = 'answered') = (answer IS NOT NULL))
);
