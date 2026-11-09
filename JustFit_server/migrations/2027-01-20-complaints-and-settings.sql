-- Gym Hub ecosystem (the user's brief of 2026-11-09, section 7): complaints and platform settings.
--   1. complaints and complaint_events: a member reports a gym; justFit admins investigate, assign,
--      keep internal notes and resolve or dismiss it; every step is kept.
--   2. platform_settings: justFit-wide defaults the Super Admin changes (gym registration open,
--      required documents, the default pause policy and crowd levels for branches without their own).
--   3. notifications.category gains 'platform' (admins hear about new complaints).
--
-- Creates three tables and widens one ENUM; nothing is deleted. Safe to run more than once. Run by
-- hand, from JustFit_server, after 2027-01-04-notifications.sql, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-20-complaints-and-settings.sql

CREATE TABLE IF NOT EXISTS complaints (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id       INT UNSIGNED NOT NULL,                -- the branch reported
  reporter_id  VARCHAR(64)  NULL,                    -- the member who reported it
  category     ENUM('safety', 'billing', 'staff', 'facility', 'false_info', 'other') NOT NULL,
  details      VARCHAR(1000) NOT NULL,
  status       ENUM('open', 'investigating', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  assigned_to  VARCHAR(64)  NULL,                    -- the justFit admin on the case
  resolution   VARCHAR(500) NULL,                    -- what the reporter is told when it closes
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_complaints_status (status, id),
  KEY idx_complaints_gym (gym_id, id),
  KEY idx_complaints_reporter (reporter_id, id),
  CONSTRAINT fk_complaints_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_complaints_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_complaints_assigned FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS complaint_events (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  complaint_id  INT UNSIGNED NOT NULL,
  kind          ENUM('created', 'assigned', 'note', 'status') NOT NULL,
  status        ENUM('open', 'investigating', 'resolved', 'dismissed') NULL,
  note          VARCHAR(1000) NULL,                  -- internal: never shown to the reporter
  by_user       VARCHAR(64)  NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_complaint_events (complaint_id, id),
  CONSTRAINT fk_complaint_events_complaint FOREIGN KEY (complaint_id) REFERENCES complaints (id),
  CONSTRAINT fk_complaint_events_by FOREIGN KEY (by_user) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key  VARCHAR(40)  NOT NULL,                -- platform/settingsRules.js KEYS
  value        JSON         NOT NULL,
  updated_by   VARCHAR(64)  NULL,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_platform_settings_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'category' AND COLUMN_TYPE LIKE '%''platform''%');
SET @tbl := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications');
SET @sql := IF(@tbl = 1 AND @has = 0, 'ALTER TABLE notifications MODIFY category ENUM(''membership'', ''pauses'', ''attendance'', ''gym'', ''registration'', ''platform'') NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
