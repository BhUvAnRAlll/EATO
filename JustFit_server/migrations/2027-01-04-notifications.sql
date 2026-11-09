-- Gym Hub ecosystem (the user's brief of 2026-11-09, section 9): in-app notifications. Members hear
-- about their memberships, pauses and gyms; gym staff about pause requests, new members, expiring
-- memberships and crowd alerts; justFit admins about gym registrations. Each person can switch a
-- category off. A notification is written once per person and event (dedupe_key), never twice.
-- There is no push: the app shows them on its Notifications screen.
--
-- Creates two tables (both removed with the account); nothing else changes. Safe to run more than
-- once. Run by hand, from JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-04-notifications.sql

CREATE TABLE IF NOT EXISTS notifications (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      VARCHAR(64)  NOT NULL,
  category     ENUM('membership', 'pauses', 'attendance', 'gym', 'registration') NOT NULL,
  kind         VARCHAR(40)  NOT NULL,                -- e.g. pause.approved (notifications/rules.js KINDS)
  title        VARCHAR(120) NOT NULL,
  body         VARCHAR(300) NOT NULL,
  link         VARCHAR(200) NULL,                    -- an app route from the allowlist, or none
  dedupe_key   VARCHAR(120) NOT NULL,                -- one notification per person and event
  read_at      TIMESTAMP    NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_once (user_id, dedupe_key),
  KEY idx_notifications_user (user_id, id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id      VARCHAR(64)  NOT NULL,
  muted        JSON         NOT NULL,                -- categories switched off, e.g. ["attendance"]
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_notification_prefs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
