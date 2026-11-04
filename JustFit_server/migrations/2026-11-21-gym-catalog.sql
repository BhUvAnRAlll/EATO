-- Plans / Catalogue (asked for by the user on 2026-11-04): each branch's price list of membership
-- plans, PT packages, services and products, kept by its gym admin. The admission, renewal, PT,
-- service and product forms fill the price from it; payments keep their own amount, so the list can change freely.
-- Run after 2026-11-20-gym-branches.sql. In order:
--   1. creates gym_catalog_items (plans, PT, services, products)
--   2. gym_payments.kind accepts 'service' (a service sold, e.g. a steam bath or a diet plan)
--   3. gym_members gets plan_days: a plan can last days (a 15-day pass) as well as months
--
-- Safe to run more than once: each step checks first; nothing is deleted. Run by
-- hand, with an account allowed to create tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-21-gym-catalog.sql

-- 1. The price list
CREATE TABLE IF NOT EXISTS gym_catalog_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,                -- the branch whose price list it is
  kind        ENUM('plan', 'pt', 'service', 'product') NOT NULL,
  name        VARCHAR(80)  NOT NULL,                -- "3 Months", "12 sessions", "Steam bath", "Whey Protein 1kg"
  duration       SMALLINT UNSIGNED NULL,            -- plans only: how long
  duration_unit  ENUM('months', 'days') NULL,       -- plans only: 1-24 months or 1-365 days
  price       INT UNSIGNED NOT NULL,                -- rupees
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_catalog_kind (gym_id, kind),
  CONSTRAINT fk_gym_catalog_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_catalog_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_catalog_price CHECK (price BETWEEN 1 AND 1000000),
  CONSTRAINT chk_gym_catalog_length CHECK (
    (kind = 'plan' AND ((duration_unit = 'months' AND duration BETWEEN 1 AND 24) OR (duration_unit = 'days' AND duration BETWEEN 1 AND 365)))
    OR (kind <> 'plan' AND duration IS NULL AND duration_unit IS NULL))
) ENGINE = InnoDB;

-- 2. Service payments
SET @has_service := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_payments' AND COLUMN_NAME = 'kind' AND COLUMN_TYPE LIKE '%''service''%');
SET @sql := IF(@has_service = 0, 'ALTER TABLE gym_payments MODIFY kind ENUM(''admission'', ''renewal'', ''due'', ''sale'', ''pt'', ''service'') NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Plans in days
SET @has_days := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'plan_days');
SET @sql := IF(@has_days = 0, 'ALTER TABLE gym_members MODIFY plan_months TINYINT UNSIGNED NULL, ADD COLUMN plan_days SMALLINT UNSIGNED NULL AFTER plan_months, ADD CONSTRAINT chk_gym_members_plan_days CHECK (plan_days BETWEEN 1 AND 365), ADD CONSTRAINT chk_gym_members_plan_one CHECK ((plan_months IS NULL) <> (plan_days IS NULL))', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
