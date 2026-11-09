-- Meal Operations phase 3 (2026-11-10, MEAL-OPERATIONS-PLAN.md): orders go through kitchens.
-- An order is given a kitchen when it is placed (the pincode it serves, open at the meal time,
-- active, cooking every meal in it with stock for the recipes, and room in its capacity) and
-- moves New → Accepted → Preparing → Quality check → Ready → Out for delivery → Delivered, each
-- step on its timeline. Starting to prepare takes the recipes' stock. Each meal time can have a
-- daily capacity across justFit, and holidays close ordering for a day.
-- Run once, after 2026-12-31:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-05-kitchen-orders.sql

ALTER TABLE orders
  MODIFY COLUMN status ENUM('awaiting_payment', 'placed', 'accepted', 'preparing', 'quality_check', 'ready', 'out_for_delivery', 'delivered', 'cancelled') NOT NULL DEFAULT 'placed',
  ADD COLUMN kitchen_id INT UNSIGNED NULL AFTER user_id,
  ADD COLUMN stock_taken TINYINT(1) NOT NULL DEFAULT 0 AFTER kitchen_id,
  ADD KEY idx_orders_kitchen_day (kitchen_id, delivery_date),
  ADD CONSTRAINT fk_orders_kitchen FOREIGN KEY (kitchen_id) REFERENCES kitchens (id) ON DELETE SET NULL;

-- Every step an order takes, who took it and why (a reason for a rejection, a kitchen change)
CREATE TABLE IF NOT EXISTS order_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id    CHAR(36)     NOT NULL,
  status      VARCHAR(24)  NOT NULL,
  note        VARCHAR(200) NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_order_events_order (order_id, created_at),
  CONSTRAINT fk_order_events_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_events_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Orders a meal time can take in a day across justFit (NULL: no limit)
ALTER TABLE meal_delivery_slots ADD COLUMN capacity SMALLINT UNSIGNED NULL AFTER active;

-- Days with no deliveries (a festival, a strike): ordering for them is closed
CREATE TABLE IF NOT EXISTS meal_holidays (
  day         DATE         NOT NULL,
  note        VARCHAR(80)  NOT NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day),
  CONSTRAINT fk_meal_holidays_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- The order a stock use was for (cooking it). No foreign key: stock history outlives orders, and
-- schema.sql creates stock_moves before orders
ALTER TABLE stock_moves ADD COLUMN order_id CHAR(36) NULL AFTER other_kitchen_id;
