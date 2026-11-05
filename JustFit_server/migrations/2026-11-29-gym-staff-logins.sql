-- Staff / Admin Login (asked for by the user on 2026-11-05): a gym admin adds people to their
-- branch's team by mobile number, as Staff (the gym portal) or Trainer (the member app with their
-- PT clients). Adding changes the account's role; a number that has never signed in waits as an
-- invite and joins at its first sign-in. In order:
--   1. users.role gets 'trainer'
--   2. gym_staff gets kind: owner (linked by the justFit Super Admin; everyone linked today),
--      staff or trainer
--   3. gym_staff_invites: numbers invited to a branch that haven't signed in yet (one per number
--      per branch; used up when that number signs in)
--   4. gym_members gets pt_trainer_id: the trainer a member's PT is with (set from part 2 of the
--      feature; cleared when that trainer leaves the branch)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-28-gym-enquiry-followup.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-29-gym-staff-logins.sql

-- 1. The trainer role (the ENUM keeps its earlier values in the same order)
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role' AND COLUMN_TYPE LIKE '%trainer%');
SET @sql := IF(@has = 0, "ALTER TABLE users MODIFY COLUMN role ENUM('user', 'admin', 'gym_admin', 'trainer') NOT NULL DEFAULT 'user'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. What each team member is at the branch; everyone linked so far is the gym admin
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_staff' AND COLUMN_NAME = 'kind');
SET @sql := IF(@has = 0, "ALTER TABLE gym_staff ADD COLUMN kind ENUM('owner', 'staff', 'trainer') NOT NULL DEFAULT 'owner' AFTER gym_id", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Invites waiting for a first sign-in
CREATE TABLE IF NOT EXISTS gym_staff_invites (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,
  phone       CHAR(10)     NOT NULL,                -- 10 digits, +91 implied
  kind        ENUM('staff', 'trainer') NOT NULL,
  invited_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_staff_invites (gym_id, phone),
  KEY idx_gym_staff_invites_phone (phone),
  CONSTRAINT chk_gym_staff_invites_phone CHECK (phone REGEXP '^[0-9]{10}$'),
  CONSTRAINT fk_gym_staff_invites_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_staff_invites_by FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- 4. The trainer a member's PT is with
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'pt_trainer_id');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_members
  ADD COLUMN pt_trainer_id VARCHAR(64) NULL AFTER pt_until,
  ADD CONSTRAINT fk_gym_members_pt_trainer FOREIGN KEY (pt_trainer_id) REFERENCES users (id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
