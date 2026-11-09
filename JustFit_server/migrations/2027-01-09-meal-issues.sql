-- Meal Operations phase 6 (2026-11-10, MEAL-OPERATIONS-PLAN.md): members' problems with an order or
-- a meal plan (cancellation, refund, missing / incorrect / damaged meal, late or failed delivery,
-- subscription) with an optional photo, worked by the Super Admin: assigned, in progress, then
-- resolved (with a note and, when given, a refund amount recorded as a decision: payments are in
-- test mode, so no money moves) or rejected with a reason. Every step is in meal_issue_events.
-- Run once, after 2027-01-08:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-09-meal-issues.sql

CREATE TABLE IF NOT EXISTS meal_issues (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,         -- shown as ISS-0001
  user_id          VARCHAR(64)  NOT NULL,
  order_id         CHAR(36)     NULL,
  subscription_id  CHAR(36)     NULL,
  category         ENUM('cancellation', 'refund', 'missing_meal', 'wrong_meal', 'damaged_food', 'late_delivery', 'failed_delivery', 'subscription', 'other') NOT NULL,
  description      VARCHAR(600) NOT NULL,
  photo_key        VARCHAR(64)  NULL,                            -- the member's photo (meals/photos.js), admins only
  status           ENUM('open', 'in_progress', 'resolved', 'rejected') NOT NULL DEFAULT 'open',
  assigned_to      VARCHAR(64)  NULL,
  resolution_note  VARCHAR(300) NULL,
  refund_paise     INT UNSIGNED NULL,
  resolved_at      TIMESTAMP    NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meal_issues_status (status, created_at),
  KEY idx_meal_issues_user (user_id, created_at),
  KEY idx_meal_issues_order (order_id),
  CONSTRAINT fk_meal_issues_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_issues_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT fk_meal_issues_subscription FOREIGN KEY (subscription_id) REFERENCES meal_subscriptions (id) ON DELETE SET NULL,
  CONSTRAINT fk_meal_issues_assignee FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- The issue's audit trail: opened, assigned, in progress, a note, refunded, resolved, rejected
CREATE TABLE IF NOT EXISTS meal_issue_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  issue_id    INT UNSIGNED NOT NULL,
  action      VARCHAR(20)  NOT NULL,
  note        VARCHAR(300) NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_meal_issue_events_issue (issue_id, created_at),
  CONSTRAINT fk_meal_issue_events_issue FOREIGN KEY (issue_id) REFERENCES meal_issues (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_issue_events_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
