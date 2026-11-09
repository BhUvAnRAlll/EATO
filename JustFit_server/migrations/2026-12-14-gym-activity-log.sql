-- Activity log (asked for by the user on 2026-11-09): every add, edit and delete made in the gym
-- portal, by Staff or the gym admin, so the gym admin can see who did what (☰ › Activity). One row
-- per change: the branch, who made it (and whether they were Staff or the gym admin), what kind of
-- change, what it was made to (its name kept as it was, so a deleted plan still reads "Gold") and a
-- short line of what changed (field names; amounts and prices with their values, never phone
-- numbers). Rows older than a year are deleted when the log is read. In order:
--   1. gym_activity_log
--
-- Safe to run more than once: it checks first, and nothing is deleted. Before it runs, the portal
-- works as before, nothing is recorded, and Activity answers that this migration is needed. Run
-- after 2026-12-13-added-templates.sql, by hand, with an account allowed to create tables:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-14-gym-activity-log.sql

-- 1. The log
CREATE TABLE IF NOT EXISTS gym_activity_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id        INT UNSIGNED NOT NULL,                -- the branch it happened at
  actor_id      VARCHAR(64)  NULL,                    -- who made it (NULL once their account is deleted)
  actor_kind    ENUM('owner', 'staff') NOT NULL,      -- the gym admin or a Staff login, at the time
  action        ENUM('create', 'edit', 'delete') NOT NULL,
  target_type   ENUM('member', 'payment', 'enquiry', 'catalog', 'expense', 'pause', 'attendance', 'sms', 'template', 'settings', 'team') NOT NULL,
  target_id     VARCHAR(64)  NULL,
  target_label  VARCHAR(120) NOT NULL,                -- "Arjun M (FOR-TUM-0003)", kept as it was
  detail        VARCHAR(200) NULL,                    -- "Changed: weight, address" or "₹1,500 · cash"
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_gym_activity_time (gym_id, created_at),
  KEY idx_gym_activity_actor (gym_id, actor_id, created_at),
  CONSTRAINT fk_gym_activity_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_activity_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
