-- The Super Admin portal: an audit log of admin actions, trainer verification, and a gym's
-- status (active, on a trial, or suspended). Adds to an existing database; safe to run more
-- than once. schema.sql has all of this for a fresh install. Run by hand with an account
-- allowed to create and alter tables (eato_app can't), e.g.:
--   mysql -u root -p eato < migrations/2026-10-28-admin-portal.sql
--
-- Existing gyms become "active" and existing trainers unverified. Nothing cascades more than
-- one level from users; an admin who leaves keeps their log rows (admin_id becomes NULL).

-- Every admin action: who, what, on which thing, and a one-line summary for the Overview
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  admin_id     VARCHAR(64)  NULL,
  action       VARCHAR(40)  NOT NULL,                -- e.g. trainer.verify, gym.suspend, report.dismiss
  target_type  ENUM('user', 'gym', 'post', 'report', 'promotion') NOT NULL,
  target_id    VARCHAR(64)  NULL,
  summary      VARCHAR(200) NOT NULL,                -- "Verified Marcus Johnson", shown as written
  created_at   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),  -- sub-second, so actions keep their order
  PRIMARY KEY (id),
  KEY idx_admin_audit_recent (created_at),
  KEY idx_admin_audit_target (target_type, target_id),
  CONSTRAINT fk_admin_audit_admin FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- MySQL has no ADD COLUMN IF NOT EXISTS: each column is checked first

-- A trainer an EATO admin has checked (their profile shows a Verified badge)
SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trainer_profiles' AND COLUMN_NAME = 'verified_at') = 0,
  'ALTER TABLE trainer_profiles ADD COLUMN verified_at TIMESTAMP NULL AFTER accepting_clients, ADD COLUMN verified_by VARCHAR(64) NULL AFTER verified_at, ADD CONSTRAINT fk_trainer_profiles_verifier FOREIGN KEY (verified_by) REFERENCES users (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;

-- A gym's standing: active, on a trial (until trial_ends_at), or suspended by an EATO admin
-- (hidden from Explore, its posts hidden from everyone)
SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'status') = 0,
  'ALTER TABLE gyms ADD COLUMN status ENUM(''active'', ''trial'', ''suspended'') NOT NULL DEFAULT ''active'' AFTER plan, ADD COLUMN trial_ends_at DATE NULL AFTER status, ADD COLUMN suspended_at TIMESTAMP NULL AFTER trial_ends_at, ADD KEY idx_gyms_status (status)',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;
