-- Per-meal subscriptions (2026-11-10, the user's meal page design): a member subscribes to one meal
-- from its page (this meal, this many, at a meal time they pick, every day for 3 / 7 / 15 / 26
-- days) at the menu price less the length's discount. The Super Admin sets the lengths and their
-- % off once for every meal (Meals › Subscription prices). They replace the whole meal plans for new
-- subscriptions; plan subscriptions already running keep going until they end (plan_id stays).
-- Run once, after 2027-01-09:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-10-meal-item-subscriptions.sql

CREATE TABLE IF NOT EXISTS subscription_lengths (
  id           INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  label        VARCHAR(20)       NOT NULL,                 -- "1 Month"
  days         SMALLINT UNSIGNED NOT NULL,                 -- delivery days (the meals at quantity 1)
  percent_off  TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  active       TINYINT(1)        NOT NULL DEFAULT 1,
  sort_order   SMALLINT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_lengths_days (days),
  CONSTRAINT chk_subscription_lengths_days CHECK (days BETWEEN 1 AND 90),
  CONSTRAINT chk_subscription_lengths_off CHECK (percent_off <= 50)
) ENGINE = InnoDB;

-- A meal subscription: the meal (copied by name like an order's items), the meal time, how many a
-- day, and the price per meal and % off it was bought at
ALTER TABLE meal_subscriptions
  MODIFY COLUMN plan_name VARCHAR(120) NOT NULL,
  ADD COLUMN meal_id VARCHAR(64) NULL AFTER plan_name,
  ADD COLUMN slot ENUM('breakfast', 'lunch', 'dinner') NULL AFTER meal_id,
  ADD COLUMN quantity TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER slot,
  ADD COLUMN unit_price_paise INT UNSIGNED NULL AFTER quantity,
  ADD COLUMN percent_off TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER unit_price_paise,
  ADD KEY idx_meal_subscriptions_meal (meal_id),
  ADD CONSTRAINT fk_meal_subscriptions_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE SET NULL;

-- The lengths from the design
INSERT IGNORE INTO subscription_lengths (label, days, percent_off, sort_order) VALUES
  ('3 Days', 3, 3, 1), ('7 Days', 7, 5, 2), ('15 Days', 15, 7, 3), ('1 Month', 26, 10, 4);
