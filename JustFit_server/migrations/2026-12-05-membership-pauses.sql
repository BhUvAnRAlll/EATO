-- Pause Membership (2026-11-07, the user's two workflows): a member asks for a pause from the
-- justFit app (Profile › Gym membership), the gym's staff approve or reject it; or staff pause a
-- membership themselves from the member's ⋯ sheet. An approved pause adds its days to the plan's
-- end date (gym_members.expires_on) and blocks QR check-ins while it runs. extended_days keeps
-- what was added, so the record stays readable after later renewals.
--
-- Safe to run more than once: it creates nothing that exists and deletes nothing. Run after
-- 2026-12-04-catalog-images.sql, by hand, with an account allowed to create tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-05-membership-pauses.sql

CREATE TABLE IF NOT EXISTS gym_membership_pauses (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id         INT UNSIGNED NOT NULL,
  member_id      INT UNSIGNED NOT NULL,
  requested_by   ENUM('member', 'staff') NOT NULL,
  status         ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  pause_from     DATE         NOT NULL,
  pause_until    DATE         NOT NULL,              -- the last paused day
  days           SMALLINT UNSIGNED NOT NULL,         -- pause_until - pause_from + 1, by the server
  reason         VARCHAR(200) NOT NULL,
  requester_id   VARCHAR(64)  NULL,                  -- the account that asked (the member's, or the staff login's)
  decided_by     VARCHAR(64)  NULL,                  -- the staff login that approved or rejected
  decided_at     TIMESTAMP    NULL,
  decision_note  VARCHAR(200) NULL,
  extended_days  SMALLINT UNSIGNED NULL,             -- days added to expires_on when approved
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_pauses_gym (gym_id, status, id),
  KEY idx_gym_pauses_member (member_id, status, id),
  CONSTRAINT fk_gym_pauses_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_pauses_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_pauses_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_pauses_decided_by FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_pauses_dates CHECK (pause_until >= pause_from),
  CONSTRAINT chk_gym_pauses_days CHECK (days BETWEEN 1 AND 365)
) ENGINE = InnoDB;
