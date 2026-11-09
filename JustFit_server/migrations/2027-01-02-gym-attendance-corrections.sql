-- Gym Hub ecosystem (the user's brief of 2026-11-09): attendance corrections. A gym's staff (with
-- Attendance › Correct visits) can fix a visit's check-in and check-out times or add a visit the
-- member forgot to scan, always with a reason; every correction is kept here with the times before
-- and after, who made it and when. Members' visits themselves stay in gym_attendance.
--
-- Creates one table; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-02-gym-attendance-corrections.sql

CREATE TABLE IF NOT EXISTS gym_attendance_corrections (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id         INT UNSIGNED NOT NULL,
  attendance_id  INT UNSIGNED NOT NULL,               -- the visit corrected or added
  member_id      INT UNSIGNED NOT NULL,
  kind           ENUM('add', 'edit') NOT NULL,
  before_in      TIMESTAMP    NULL,                   -- the times before an edit (NULL for an added visit)
  before_out     TIMESTAMP    NULL,
  after_in       TIMESTAMP    NOT NULL,
  after_out      TIMESTAMP    NULL,
  reason         VARCHAR(200) NOT NULL,
  by_user        VARCHAR(64)  NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_gym_att_corrections_gym (gym_id, id),
  KEY idx_gym_att_corrections_visit (attendance_id),
  CONSTRAINT fk_gym_att_corrections_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_att_corrections_visit FOREIGN KEY (attendance_id) REFERENCES gym_attendance (id),
  CONSTRAINT fk_gym_att_corrections_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_att_corrections_by FOREIGN KEY (by_user) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
