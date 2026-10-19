-- QR attendance for the gym owner portal: a visit per check-in (gym_visits), every failed scan at
-- the front desk (gym_scan_failures), and the gym's check-out QR (two columns on gyms). Approved by
-- the user on 2026-10-18. Safe to run more than once: each step checks first. Run after
-- 2026-10-25-assistant-default.sql, by hand, with an account allowed to create and alter tables
-- (eato_app can't), for example:
--   mysql -u root -p eato < migrations/2026-10-26-gym-attendance.sql

-- One row per visit. A member has at most one open visit per gym (open_member), so a repeated tap
-- or a second scan can never check them in twice. Visits are kept when a gym is closed
-- (gyms are never deleted) and go with the member's account.
CREATE TABLE IF NOT EXISTS gym_visits (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id           CHAR(36)     NOT NULL,
  user_id          VARCHAR(64)  NOT NULL,
  checked_in_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_in_by    VARCHAR(64)  NULL,                   -- the staff member who scanned them in
  checked_out_at   TIMESTAMP    NULL,
  checkout_method  ENUM('qr', 'staff') NULL,            -- scanned the gym's code, or staff ended it
  checked_out_by   VARCHAR(64)  NULL,                   -- the staff member, for 'staff'
  open_member      VARCHAR(101) AS (IF(checked_out_at IS NULL, CONCAT(gym_id, ':', user_id), NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_visits_open (open_member),
  KEY idx_gym_visits_gym_day (gym_id, checked_in_at),
  KEY idx_gym_visits_user (user_id, checked_in_at),
  CONSTRAINT fk_gym_visits_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gym_visits_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_visits_in_by FOREIGN KEY (checked_in_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_visits_out_by FOREIGN KEY (checked_out_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_visits_out CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at),
  CONSTRAINT chk_gym_visits_method CHECK ((checked_out_at IS NULL) = (checkout_method IS NULL))
);

-- A scan that didn't check anyone in, and why. user_id only when the code named a real member.
CREATE TABLE IF NOT EXISTS gym_scan_failures (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)     NOT NULL,
  scanned_by  VARCHAR(64)  NULL,
  user_id     VARCHAR(64)  NULL,
  reason      ENUM('invalid', 'expired', 'not_member', 'inactive', 'already_in') NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_scan_failures_gym_day (gym_id, created_at),
  CONSTRAINT fk_gym_scan_failures_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gym_scan_failures_by FOREIGN KEY (scanned_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_scan_failures_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- The gym's check-out QR: on or off, and its code (made the first time an owner opens it, and
-- replaced when they regenerate it)
SET @has_checkout_enabled := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'checkout_qr_enabled'
);
SET @add_checkout_enabled := IF(@has_checkout_enabled = 0,
  'ALTER TABLE gyms ADD COLUMN checkout_qr_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER post_moderation',
  'SELECT 1');
PREPARE add_checkout_enabled FROM @add_checkout_enabled;
EXECUTE add_checkout_enabled;
DEALLOCATE PREPARE add_checkout_enabled;

SET @has_checkout_code := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'checkout_code'
);
SET @add_checkout_code := IF(@has_checkout_code = 0,
  'ALTER TABLE gyms ADD COLUMN checkout_code CHAR(12) NULL AFTER checkout_qr_enabled, ADD UNIQUE KEY uq_gyms_checkout_code (checkout_code)',
  'SELECT 1');
PREPARE add_checkout_code FROM @add_checkout_code;
EXECUTE add_checkout_code;
DEALLOCATE PREPARE add_checkout_code;
