-- Meal Operations phase 5 (2026-11-10, MEAL-OPERATIONS-PLAN.md and the user's design: Meal
-- Subscription tab, plan details with 7 / 28 / 90 days): meal plans and members' subscriptions.
-- A plan has meals a day, daily targets, what's included, the meals it rotates through and a price
-- for each length. A subscription is paid like an order (test checkout, Razorpay's flow), starts on
-- a day, and each delivery day an order is made for each meal time (through the kitchens and
-- delivery like any order). A meal is used only when its order is delivered. Pausing or skipping
-- a day moves the end date on. Run once, after 2027-01-07:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-08-meal-subscriptions.sql

CREATE TABLE IF NOT EXISTS meal_plans (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  slug             VARCHAR(40)   NOT NULL,
  name             VARCHAR(40)   NOT NULL,
  tagline          VARCHAR(60)   NOT NULL,                 -- "Calorie deficit, high protein"
  description      VARCHAR(200)  NOT NULL,
  goal             ENUM('fat_loss', 'muscle_gain', 'maintain', 'custom') NOT NULL,
  meals_per_day    TINYINT UNSIGNED NOT NULL,              -- 1 lunch · 2 lunch and dinner · 3 all three
  calories         SMALLINT UNSIGNED NOT NULL,             -- a day
  protein_g        SMALLINT UNSIGNED NOT NULL,
  carbs_g          SMALLINT UNSIGNED NOT NULL,
  fat_g            SMALLINT UNSIGNED NOT NULL,
  water_l          DECIMAL(3,1)  NOT NULL,
  included         JSON          NOT NULL,                 -- ["Personalized, macro-balanced meals", …]
  image_key        VARCHAR(64)   NULL,
  active           TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order       SMALLINT      NOT NULL DEFAULT 0,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_plans_slug (slug),
  CONSTRAINT chk_meal_plans_meals CHECK (meals_per_day BETWEEN 1 AND 3)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS meal_plan_lengths (
  plan_id      INT UNSIGNED NOT NULL,
  days         SMALLINT UNSIGNED NOT NULL,
  price_paise  INT UNSIGNED NOT NULL,
  PRIMARY KEY (plan_id, days),
  CONSTRAINT fk_meal_plan_lengths_plan FOREIGN KEY (plan_id) REFERENCES meal_plans (id) ON DELETE CASCADE,
  CONSTRAINT chk_meal_plan_lengths_days CHECK (days BETWEEN 1 AND 365)
) ENGINE = InnoDB;

-- The meals a plan rotates through
CREATE TABLE IF NOT EXISTS meal_plan_meals (
  plan_id  INT UNSIGNED NOT NULL,
  meal_id  VARCHAR(64)  NOT NULL,
  PRIMARY KEY (plan_id, meal_id),
  CONSTRAINT fk_meal_plan_meals_plan FOREIGN KEY (plan_id) REFERENCES meal_plans (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_plan_meals_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS meal_subscriptions (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id          VARCHAR(64)  NOT NULL,
  client_id        CHAR(36)     NULL,
  plan_id          INT UNSIGNED NULL,
  plan_name        VARCHAR(40)  NOT NULL,                   -- copied, like an order's meals
  days             SMALLINT UNSIGNED NOT NULL,
  meals_per_day    TINYINT UNSIGNED NOT NULL,
  calories         SMALLINT UNSIGNED NOT NULL,
  price_paise      INT UNSIGNED NOT NULL,
  status           ENUM('awaiting_payment', 'active', 'paused', 'cancelled', 'completed') NOT NULL DEFAULT 'awaiting_payment',
  starts_on        DATE         NOT NULL,
  ends_on          DATE         NOT NULL,                   -- moves on with pauses and skipped days
  paused_from      DATE         NULL,
  paused_until     DATE         NULL,
  receiver_name    VARCHAR(60)  NULL,
  receiver_phone   CHAR(10)     NULL,
  delivery_address VARCHAR(400) NULL,
  delivery_pincode CHAR(6)      NOT NULL,
  latitude         DECIMAL(9,6) NULL,
  longitude        DECIMAL(9,6) NULL,
  payment_method   ENUM('dummy', 'razorpay', 'admin') NULL,
  payment_ref      VARCHAR(40)  NULL,
  cancel_reason    VARCHAR(200) NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_subscriptions_client (user_id, client_id),
  KEY idx_meal_subscriptions_status (status, starts_on, ends_on),
  CONSTRAINT fk_meal_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES meal_plans (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Each subscription day and meal time: skipped by the member, or the order made for it
CREATE TABLE IF NOT EXISTS subscription_days (
  subscription_id  CHAR(36)    NOT NULL,
  day              DATE        NOT NULL,
  slot             ENUM('breakfast', 'lunch', 'dinner') NOT NULL,
  status           ENUM('skipped', 'ordered', 'unfilled') NOT NULL,
  order_id         CHAR(36)    NULL,
  note             VARCHAR(120) NULL,
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subscription_id, day, slot),
  KEY idx_subscription_days_order (order_id),
  CONSTRAINT fk_subscription_days_subscription FOREIGN KEY (subscription_id) REFERENCES meal_subscriptions (id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_days_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- An order made for a subscription (paid by it, total 0)
ALTER TABLE orders
  ADD COLUMN subscription_id CHAR(36) NULL AFTER kitchen_id,
  MODIFY COLUMN payment_method ENUM('test', 'dummy', 'razorpay', 'subscription') NULL,
  ADD KEY idx_orders_subscription (subscription_id),
  ADD CONSTRAINT fk_orders_subscription FOREIGN KEY (subscription_id) REFERENCES meal_subscriptions (id) ON DELETE SET NULL;

-- A payment can be for a subscription instead of an order
ALTER TABLE meal_payments
  MODIFY COLUMN order_id CHAR(36) NULL,
  ADD COLUMN subscription_id CHAR(36) NULL AFTER order_id,
  ADD KEY idx_meal_payments_subscription (subscription_id),
  ADD CONSTRAINT fk_meal_payments_subscription FOREIGN KEY (subscription_id) REFERENCES meal_subscriptions (id) ON DELETE CASCADE;

-- The three plans from the design (the Super Admin can change them)
INSERT IGNORE INTO meal_plans (slug, name, tagline, description, goal, meals_per_day, calories, protein_g, carbs_g, fat_g, water_l, included, sort_order) VALUES
  ('fat-loss', 'Fat Loss Plan', 'Calorie deficit, high protein', 'Sustainable weight loss with balanced, high-protein meals', 'fat_loss', 3, 2200, 150, 220, 70, 3.0,
   JSON_ARRAY('Personalized, macro-balanced meals', 'Fresh & hygienic preparation', 'Scheduled daily delivery', 'Plan support & recommendations'), 1),
  ('muscle-gain', 'Muscle Gain Plan', 'Protein rich, calorie surplus', 'Build lean muscle with protein-rich meals and a steady calorie surplus', 'muscle_gain', 3, 2800, 180, 320, 85, 3.5,
   JSON_ARRAY('Personalized, macro-balanced meals', 'Fresh & hygienic preparation', 'Scheduled daily delivery', 'Plan support & recommendations'), 2),
  ('weight-maintain', 'Weight Maintain Plan', 'Balanced & sustainable', 'Keep your weight steady with balanced Indian meals every day', 'maintain', 3, 2400, 120, 280, 75, 3.0,
   JSON_ARRAY('Personalized, macro-balanced meals', 'Fresh & hygienic preparation', 'Scheduled daily delivery', 'Plan support & recommendations'), 3);
INSERT IGNORE INTO meal_plan_lengths (plan_id, days, price_paise)
  SELECT p.id, l.days, l.price FROM meal_plans p JOIN (
    SELECT 'fat-loss' AS slug, 7 AS days, 189900 AS price UNION ALL SELECT 'fat-loss', 28, 699900 UNION ALL SELECT 'fat-loss', 90, 1899900
    UNION ALL SELECT 'muscle-gain', 7, 219900 UNION ALL SELECT 'muscle-gain', 28, 799900 UNION ALL SELECT 'muscle-gain', 90, 2199900
    UNION ALL SELECT 'weight-maintain', 7, 179900 UNION ALL SELECT 'weight-maintain', 28, 649900 UNION ALL SELECT 'weight-maintain', 90, 1749900
  ) l ON l.slug = p.slug;
