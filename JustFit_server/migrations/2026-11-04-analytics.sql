-- App usage event tracking for the Super Admin portal (Admin › Profile › App Usage, phase 2).
-- New tables only, nothing existing changes; safe to run more than once. Run by hand with an
-- account allowed to create tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-04-analytics.sql
--
-- Until it has run, the server keeps working: POST /api/analytics/events answers 503 and the app
-- keeps its queue, and App Usage reports screen visits and sessions as not tracked.

-- ---- App usage events (Super Admin › Profile › App Usage, phase 2, 2026-10-30) ----
-- What members do in the app, sent by the app in small batches to POST /api/analytics/events for
-- the signed-in member only (the app never names one). An event is a name from a fixed list, the
-- module it belongs to, the screen when it is a view, a few flat plain values as metadata (no
-- personal data: analytics/rules.js refuses the keys that would carry it), and when it happened on
-- the device. The app makes the id, so a retried batch never stores an event twice. user_id is set
-- to NULL when the account is deleted (one level below users, see the cascade note above), so
-- counts stay right without keeping anything that names the person.
CREATE TABLE IF NOT EXISTS analytics_events (
  id            CHAR(36)      NOT NULL,                     -- made by the app (UUID), the dedup key
  user_id       VARCHAR(64)   NULL,
  session_id    CHAR(36)      NOT NULL,                     -- one app launch (analytics_sessions)
  event_name    VARCHAR(40)   NOT NULL,
  module        VARCHAR(20)   NOT NULL,
  screen_name   VARCHAR(60)   NULL,                         -- for screen_viewed
  metadata      JSON          NULL,
  occurred_at   DATETIME(3)   NOT NULL,                     -- the device's time, clamped by the server
  received_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_analytics_events_time (occurred_at),
  KEY idx_analytics_events_name_time (event_name, occurred_at),
  KEY idx_analytics_events_user_time (user_id, occurred_at),
  KEY idx_analytics_events_session (session_id),
  CONSTRAINT fk_analytics_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_analytics_events_name CHECK (event_name REGEXP '^[a-z_]{3,40}$'),
  CONSTRAINT chk_analytics_events_module CHECK (module REGEXP '^[a-z_]{2,20}$')
) ENGINE = InnoDB;

-- One row per app launch: first and last event (their difference is the session's length), the
-- platform and app version, and how many events it had. Kept in step with analytics_events by
-- the server as batches arrive.
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id             CHAR(36)     NOT NULL,                     -- made by the app at launch
  user_id        VARCHAR(64)  NULL,
  platform       ENUM('ios', 'android', 'web') NOT NULL,
  app_version    VARCHAR(20)  NULL,
  started_at     DATETIME(3)  NOT NULL,
  last_event_at  DATETIME(3)  NOT NULL,
  event_count    INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_analytics_sessions_user_time (user_id, started_at),
  KEY idx_analytics_sessions_time (started_at),
  CONSTRAINT fk_analytics_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_analytics_sessions_order CHECK (last_event_at >= started_at)
) ENGINE = InnoDB;
