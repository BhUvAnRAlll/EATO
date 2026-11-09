-- Staff and trainer attendance (asked for by the user on 2026-11-09): Attendance gets two tabs,
-- Members and Staff & Trainers. Staff check in and out by scanning the branch's own attendance QR
-- code from the gym portal, trainers from their justFit app, with the same GPS checks as members;
-- the gym admin can also check them in and out by hand. Only the gym admin sees the tab. In order:
--   1. gym_staff_attendance
--
-- A visit is 'inside' while open (one open visit per person: the server keeps open_user_id = user_id
-- while inside and NULL after, under a unique key; MySQL refuses a generated column there because
-- user_id's key cascades from users),
-- 'completed' once checked out, 'no_checkout' when it was still open at midnight (India time).
-- Rows stay when someone leaves the team (history); they go only with the account itself.
--
-- Safe to run more than once: it checks first, and nothing is deleted. Before it runs, the
-- Staff & Trainers tab and a Staff or Trainer scan answer that this migration is needed. Run after
-- 2026-12-14-gym-activity-log.sql, by hand, with an account allowed to create tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-15-staff-attendance.sql

-- 1. The visits
CREATE TABLE IF NOT EXISTS gym_staff_attendance (
  id                    INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  gym_id                INT UNSIGNED      NOT NULL,          -- the branch
  user_id               VARCHAR(64)       NOT NULL,          -- the Staff or Trainer account
  on_date               DATE              NOT NULL,          -- India's date of the check-in
  checked_in_at         TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_out_at        TIMESTAMP         NULL,
  status                ENUM('inside', 'completed', 'no_checkout') NOT NULL DEFAULT 'inside',
  duration_min          SMALLINT UNSIGNED NULL,              -- worked out by the server at check-out
  in_source             ENUM('admin', 'qr') NOT NULL,
  out_source            ENUM('admin', 'qr') NULL,
  check_in_lat          DECIMAL(9,6)      NULL,
  check_in_lng          DECIMAL(9,6)      NULL,
  check_in_accuracy_m   SMALLINT UNSIGNED NULL,
  check_in_distance_m   SMALLINT UNSIGNED NULL,
  check_out_lat         DECIMAL(9,6)      NULL,
  check_out_lng         DECIMAL(9,6)      NULL,
  check_out_accuracy_m  SMALLINT UNSIGNED NULL,
  check_out_distance_m  SMALLINT UNSIGNED NULL,
  open_user_id          VARCHAR(64)       NULL,              -- user_id while inside, else NULL: set by the server (a generated column can't sit on a cascading key)
  created_by            VARCHAR(64)       NULL,              -- the gym admin, for a check-in by hand
  checked_out_by        VARCHAR(64)       NULL,
  created_at            TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_staff_attendance_open (open_user_id),
  KEY idx_gym_staff_attendance_day (gym_id, on_date),
  KEY idx_gym_staff_attendance_user (user_id, on_date),
  CONSTRAINT chk_gym_staff_attendance_open CHECK ((status = 'inside') = (open_user_id IS NOT NULL)),
  CONSTRAINT fk_gym_staff_attendance_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_staff_attendance_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_staff_attendance_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_staff_attendance_checked_out_by FOREIGN KEY (checked_out_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
