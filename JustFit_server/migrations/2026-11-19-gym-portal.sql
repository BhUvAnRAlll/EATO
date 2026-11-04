-- The gym admin portal's data (approved by the user on 2026-11-04): gyms, the gym_admin accounts
-- linked to each (gym_staff), and each gym's members, payments, enquiries and daily check-ins.
-- Run after 2026-11-18-gym-admin-role.sql. In order:
--   1-6. creates gyms, gym_staff, gym_members, gym_payments, gym_enquiries, gym_attendance
--
-- Safe to run more than once: every table is CREATE TABLE IF NOT EXISTS, and nothing is changed
-- or deleted. Run by hand, with an account allowed to create tables (justfit_app can't), e.g.:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-19-gym-portal.sql
CREATE TABLE IF NOT EXISTS gyms (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  area        VARCHAR(80)  NOT NULL,
  city        VARCHAR(60)  NOT NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_gyms_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_staff (
  user_id   VARCHAR(64)  NOT NULL,              -- a gym_admin account: one gym each
  gym_id    INT UNSIGNED NOT NULL,
  added_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_gym_staff_gym (gym_id),
  CONSTRAINT fk_gym_staff_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_staff_gym FOREIGN KEY (gym_id) REFERENCES gyms (id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_members (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id       INT UNSIGNED NOT NULL,
  full_name    VARCHAR(80)  NOT NULL,
  phone        CHAR(10)     NULL,                -- 10 digits, +91 implied
  plan_months  TINYINT UNSIGNED NOT NULL,        -- the latest plan bought
  joined_on    DATE         NOT NULL,
  expires_on   DATE         NOT NULL,            -- the last day the membership covers
  due_amount   INT UNSIGNED NOT NULL DEFAULT 0,  -- rupees still owed
  created_by   VARCHAR(64)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_members_phone (gym_id, phone),
  KEY idx_gym_members_expiry (gym_id, expires_on),
  KEY idx_gym_members_name (gym_id, full_name),
  CONSTRAINT fk_gym_members_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_members_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_members_phone CHECK (phone IS NULL OR phone REGEXP '^[6-9][0-9]{9}$'),
  CONSTRAINT chk_gym_members_plan CHECK (plan_months BETWEEN 1 AND 24),
  CONSTRAINT chk_gym_members_due CHECK (due_amount <= 1000000)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_payments (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,
  member_id   INT UNSIGNED NULL,                 -- NULL for a shop sale
  kind        ENUM('admission', 'renewal', 'due', 'sale') NOT NULL,
  title       VARCHAR(80)  NOT NULL,             -- the member's name, or the item sold
  detail      VARCHAR(80)  NOT NULL,             -- "3 Months", "Due payment", "Supplement Sale"
  method      ENUM('online', 'cash') NOT NULL,
  amount      INT UNSIGNED NOT NULL,             -- rupees
  paid_on     DATE         NOT NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_gym_payments_day (gym_id, paid_on),
  KEY idx_gym_payments_member (member_id),
  CONSTRAINT fk_gym_payments_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_payments_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_payments_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_payments_amount CHECK (amount BETWEEN 1 AND 1000000)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_enquiries (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id       INT UNSIGNED NOT NULL,
  full_name    VARCHAR(80)  NOT NULL,
  phone        CHAR(10)     NULL,
  note         VARCHAR(200) NULL,
  enquired_on  DATE         NOT NULL,
  created_by   VARCHAR(64)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_enquiries_day (gym_id, enquired_on),
  CONSTRAINT fk_gym_enquiries_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_enquiries_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_enquiries_phone CHECK (phone IS NULL OR phone REGEXP '^[6-9][0-9]{9}$')
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_attendance (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id         INT UNSIGNED NOT NULL,
  member_id      INT UNSIGNED NOT NULL,
  on_date        DATE         NOT NULL,
  checked_in_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_attendance_day (member_id, on_date),  -- one check-in a day
  KEY idx_gym_attendance_day (gym_id, on_date),
  CONSTRAINT fk_gym_attendance_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_attendance_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_attendance_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
