-- AI usage and cost management for the Super Admin portal (Admin › Profile › AI Usage). Approved
-- by the user on 2026-10-30: new tables only, nothing existing changes. Safe to run more than
-- once. Run by hand with an account allowed to create tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-03-ai-usage.sql
--
-- Until it has run, the server keeps working and simply records no AI usage (one log line).

-- One row per AI call the server makes (OpenAI or the Forma scan server), written by the server
-- itself, never from a request. No prompt, photo or reply is stored: only who it was for, which
-- feature and model, the tokens, the cost in rupees at the time (the model's dollar price at the
-- exchange rate then in ai_budget), and whether it worked. user_id is set to
-- NULL when the account is deleted (one level below users, see the cascade note in schema.sql);
-- gym_id is a structural link like the coach tables', because gyms are never hard-deleted.
CREATE TABLE IF NOT EXISTS ai_usage (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id        VARCHAR(64)      NULL,
  gym_id         CHAR(36)         NULL,
  feature        ENUM('gym_assistant', 'coach_plan', 'coach_chat', 'food_scan', 'body_scan', 'body_report') NOT NULL,
  provider       ENUM('openai', 'forma') NOT NULL,
  model          VARCHAR(64)      NOT NULL,
  input_tokens   INT UNSIGNED     NOT NULL DEFAULT 0,
  output_tokens  INT UNSIGNED     NOT NULL DEFAULT 0,
  total_tokens   INT UNSIGNED     AS (input_tokens + output_tokens) STORED,
  cost_inr       DECIMAL(12, 4)   NOT NULL DEFAULT 0,
  status         ENUM('ok', 'failed', 'refused') NOT NULL,
  duration_ms    INT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY idx_ai_usage_time (created_at),
  KEY idx_ai_usage_feature_time (feature, created_at),
  KEY idx_ai_usage_model_time (model, created_at),
  KEY idx_ai_usage_user (user_id),
  CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- What each model costs, in US dollars as OpenAI quotes it. A call's cost is worked out in rupees
-- when it is recorded (ai_budget.usd_to_inr), so changing a price or the rate changes future rows only.
CREATE TABLE IF NOT EXISTS ai_model_prices (
  model                   VARCHAR(64)    NOT NULL,
  provider                ENUM('openai', 'forma') NOT NULL,
  input_usd_per_million   DECIMAL(10, 4) NOT NULL DEFAULT 0,
  output_usd_per_million  DECIMAL(10, 4) NOT NULL DEFAULT 0,
  request_usd             DECIMAL(10, 6) NOT NULL DEFAULT 0,  -- a flat cost per call (self-hosted models)
  updated_at              TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (model)
) ENGINE = InnoDB;

INSERT IGNORE INTO ai_model_prices (model, provider, input_usd_per_million, output_usd_per_million, request_usd) VALUES
  ('gpt-4o',      'openai', 2.5000, 10.0000, 0),
  ('gpt-4o-mini', 'openai', 0.1500,  0.6000, 0),
  ('forma',       'forma',  0,       0,      0);

-- The monthly budget in rupees, the dollar exchange rate and which alerts are on: one row (id 1).
-- Reaching the limit only alerts; nothing is switched off.
CREATE TABLE IF NOT EXISTS ai_budget (
  id                 TINYINT UNSIGNED NOT NULL,
  monthly_limit_inr  DECIMAL(12, 2)   NOT NULL DEFAULT 4000.00,
  usd_to_inr         DECIMAL(8, 2)    NOT NULL DEFAULT 84.00,  -- rupees per US dollar, for new rows
  alert_50           BOOLEAN          NOT NULL DEFAULT TRUE,
  alert_75           BOOLEAN          NOT NULL DEFAULT TRUE,
  alert_90           BOOLEAN          NOT NULL DEFAULT TRUE,
  alert_100          BOOLEAN          NOT NULL DEFAULT TRUE,
  spike_alerts       BOOLEAN          NOT NULL DEFAULT TRUE,
  updated_by         VARCHAR(64)      NULL,
  updated_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_ai_budget_one_row CHECK (id = 1),
  CONSTRAINT fk_ai_budget_admin FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

INSERT IGNORE INTO ai_budget (id) VALUES (1);

-- Alerts that fired: each threshold once a month, a spike once a day
CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kind             ENUM('threshold', 'spike') NOT NULL,
  period           CHAR(10)         NOT NULL,  -- '2026-10' for a threshold, '2026-10-30' for a spike
  threshold        TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- 50, 75, 90 or 100; 0 for a spike
  spent_inr        DECIMAL(12, 4)   NOT NULL,
  detail           VARCHAR(200)     NOT NULL,
  created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at  TIMESTAMP        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_budget_alert (kind, period, threshold),
  KEY idx_ai_budget_alerts_open (acknowledged_at, created_at)
) ENGINE = InnoDB;
