-- Notices a gym sends its members (the owner portal's Notify members, renewal reminders, and the
-- automatic "checked in" and "renewed" notes), and who received each one. They show in each
-- recipient's notification bell. Approved by the user on 2026-10-18. Safe to run more than once.
-- Run after 2026-10-26-gym-attendance.sql, by hand, with an account allowed to create tables
-- (eato_app can't), for example:
--   mysql -u root -p eato < migrations/2026-10-27-gym-notices.sql

-- One row per notice. Gyms are never deleted (RESTRICT); a sender's account going leaves the notice.
CREATE TABLE IF NOT EXISTS gym_notices (
  id          CHAR(36)          NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)          NOT NULL,
  sent_by     VARCHAR(64)       NULL,
  kind        ENUM('message', 'reminder', 'checkin', 'renewal') NOT NULL,  -- message: Notify members
  title       VARCHAR(60)       NOT NULL,
  body        VARCHAR(240)      NOT NULL,
  target      ENUM('gym', 'events', 'my_qr', 'session', 'none') NOT NULL DEFAULT 'gym',  -- what tapping it opens
  audience    ENUM('everyone', 'in_gym', 'renewal_due', 'inactive', 'staff', 'chosen', 'test') NOT NULL,
  reach       SMALLINT UNSIGNED NOT NULL DEFAULT 0,                  -- how many people received it
  created_at  TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3), -- milliseconds: notices sent together keep their order
  PRIMARY KEY (id),
  KEY idx_gym_notices_gym (gym_id, kind, created_at),
  CONSTRAINT fk_gym_notices_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gym_notices_sender FOREIGN KEY (sent_by) REFERENCES users (id) ON DELETE SET NULL
);

-- Who received a notice. Goes with the notice and with the member's account.
CREATE TABLE IF NOT EXISTS gym_notice_recipients (
  notice_id   CHAR(36)     NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  PRIMARY KEY (notice_id, user_id),
  KEY idx_gym_notice_recipients_user (user_id),
  CONSTRAINT fk_gym_notice_recipients_notice FOREIGN KEY (notice_id) REFERENCES gym_notices (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_notice_recipients_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
