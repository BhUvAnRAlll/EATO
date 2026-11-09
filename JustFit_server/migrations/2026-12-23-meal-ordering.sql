-- Meal ordering (2026-11-09, approved by the user): the Super Admin keeps the menu (meals with a
-- photo, tags, categories, banners, coupons) and sets the three delivery times; members order one
-- meal time on one day, pay a test payment, and follow the order; a delivered order is logged into
-- the member's Macro diary.
-- Run once, after 2026-12-22:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-23-meal-ordering.sql

-- A meal's photo, uploaded by the admin (a file name the server made, meals/photos.js, never a
-- path); its tags; what a serving is; what's in it; and an optional price before the discount
ALTER TABLE meals
  ADD COLUMN image_key    VARCHAR(64)   NULL AFTER image_url,
  ADD COLUMN tags         SET('bestseller', 'gourmet', 'high_protein', 'special') NOT NULL DEFAULT '' AFTER diet,
  ADD COLUMN serving_size VARCHAR(40)   NULL AFTER description,
  ADD COLUMN ingredients  VARCHAR(300)  NULL AFTER serving_size,
  ADD COLUMN mrp_paise    INT UNSIGNED  NULL AFTER price_paise;

-- The Meals tab's tiles (kind 'tile': Under ₹99, High Protein…) and food categories (kind 'food':
-- Biryani & Rice Bowls…). A category lists the meals picked for it, or every meal with a tag or
-- under a price. A featured food category also shows as a row of meal cards ("Meal Bowls").
CREATE TABLE IF NOT EXISTS meal_categories (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kind             ENUM('tile', 'food') NOT NULL,
  name             VARCHAR(40)   NOT NULL,
  subtitle         VARCHAR(80)   NULL,
  badge            VARCHAR(16)   NULL,
  image_key        VARCHAR(64)   NULL,
  match_tag        ENUM('bestseller', 'gourmet', 'high_protein', 'special') NULL,
  max_price_paise  INT UNSIGNED  NULL,
  featured         TINYINT(1)    NOT NULL DEFAULT 0,
  active           TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order       SMALLINT      NOT NULL DEFAULT 0,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meal_categories_show (active, kind, sort_order)
) ENGINE = InnoDB;

-- The meals picked for a category (none when it lists by tag or price)
CREATE TABLE IF NOT EXISTS meal_category_items (
  category_id  INT UNSIGNED NOT NULL,
  meal_id      VARCHAR(64)  NOT NULL,
  PRIMARY KEY (category_id, meal_id),
  KEY idx_meal_category_items_meal (meal_id),
  CONSTRAINT fk_meal_category_items_category FOREIGN KEY (category_id) REFERENCES meal_categories (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_category_items_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The Meals tab's banner carousel. Shown while active and inside its days (India's dates); the
-- button opens a category, a meal or a tag's list.
CREATE TABLE IF NOT EXISTS meal_banners (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  title        VARCHAR(60)   NOT NULL,
  description  VARCHAR(140)  NULL,
  badge        VARCHAR(20)   NULL,
  cta_label    VARCHAR(20)   NOT NULL DEFAULT 'Explore now',
  target_kind  ENUM('category', 'meal', 'tag') NOT NULL,
  target_ref   VARCHAR(64)   NOT NULL,
  image_key    VARCHAR(64)   NULL,
  starts_on    DATE          NULL,
  ends_on      DATE          NULL,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order   SMALLINT      NOT NULL DEFAULT 0,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_meal_banners_days CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
) ENGINE = InnoDB;

-- Coupons: a percentage (with an optional cap) or a flat amount off, above a minimum order, inside
-- their days, a set number of times per member. The server checks them and prices the order.
CREATE TABLE IF NOT EXISTS meal_coupons (
  id                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code                VARCHAR(16)   NOT NULL,
  title               VARCHAR(60)   NOT NULL,
  kind                ENUM('percent', 'flat') NOT NULL,
  percent_off         TINYINT UNSIGNED NULL,
  flat_off_paise      INT UNSIGNED  NULL,
  max_discount_paise  INT UNSIGNED  NULL,
  min_order_paise     INT UNSIGNED  NOT NULL DEFAULT 0,
  per_member_limit    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  starts_on           DATE          NULL,
  ends_on             DATE          NULL,
  active              TINYINT(1)    NOT NULL DEFAULT 1,
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_coupons_code (code),
  CONSTRAINT chk_meal_coupons_kind CHECK ((kind = 'percent' AND percent_off BETWEEN 1 AND 90) OR (kind = 'flat' AND flat_off_paise > 0)),
  CONSTRAINT chk_meal_coupons_days CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
) ENGINE = InnoDB;

-- The three delivery times the admin sets. Orders for a meal time close 2 hours before it starts
-- (meals/rules.js); a meal time switched off can't be ordered.
CREATE TABLE IF NOT EXISTS meal_delivery_slots (
  slot        ENUM('breakfast', 'lunch', 'dinner') NOT NULL,
  starts_at   TIME         NOT NULL,
  ends_at     TIME         NOT NULL,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  VARCHAR(64)  NULL,
  PRIMARY KEY (slot),
  CONSTRAINT fk_meal_slots_admin FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_meal_slots_times CHECK (starts_at < ends_at)
) ENGINE = InnoDB;

INSERT IGNORE INTO meal_delivery_slots (slot, starts_at, ends_at) VALUES
  ('breakfast', '07:00', '09:00'), ('lunch', '12:30', '14:00'), ('dinner', '19:00', '21:00');

-- An order keeps a copy of where and when it goes (a later address or time change never rewrites
-- it), the test payment, why it was cancelled, and the app's id for the request (a retried Pay
-- places one order).
ALTER TABLE orders
  ADD COLUMN client_id        CHAR(36)      NULL AFTER user_id,
  ADD COLUMN slot_starts_at   TIME          NULL AFTER meal_slot,
  ADD COLUMN slot_ends_at     TIME          NULL AFTER slot_starts_at,
  ADD COLUMN receiver_name    VARCHAR(60)   NULL AFTER delivery_pincode,
  ADD COLUMN receiver_phone   CHAR(10)      NULL AFTER receiver_name,
  ADD COLUMN delivery_address VARCHAR(400)  NULL AFTER receiver_phone,
  ADD COLUMN latitude         DECIMAL(9,6)  NULL AFTER delivery_address,
  ADD COLUMN longitude        DECIMAL(9,6)  NULL AFTER latitude,
  ADD COLUMN instructions     VARCHAR(200)  NULL AFTER longitude,
  ADD COLUMN subtotal_paise   INT UNSIGNED  NULL AFTER total_paise,
  ADD COLUMN discount_paise   INT UNSIGNED  NOT NULL DEFAULT 0 AFTER subtotal_paise,
  ADD COLUMN coupon_id        INT UNSIGNED  NULL AFTER discount_paise,
  ADD COLUMN coupon_code      VARCHAR(16)   NULL AFTER coupon_id,
  ADD COLUMN payment_method   ENUM('test')  NULL AFTER coupon_code,
  ADD COLUMN payment_ref      VARCHAR(40)   NULL AFTER payment_method,
  ADD COLUMN cancel_reason    VARCHAR(200)  NULL AFTER status,
  ADD COLUMN cancelled_by     ENUM('member', 'admin') NULL AFTER cancel_reason,
  ADD UNIQUE KEY uq_orders_client (user_id, client_id),
  ADD KEY idx_orders_day (delivery_date, meal_slot),
  ADD CONSTRAINT fk_orders_coupon FOREIGN KEY (coupon_id) REFERENCES meal_coupons (id) ON DELETE SET NULL;

-- A delivered order in the Macro diary (plan_log_key "order:<order id>", so it is logged once)
ALTER TABLE macro_meal_logs MODIFY COLUMN source ENUM('manual', 'favorite', 'repeat', 'plan', 'order') NOT NULL DEFAULT 'manual';

-- The admin's meal and order actions in the audit log
ALTER TABLE admin_audit_log MODIFY COLUMN target_type
  ENUM('user', 'gym', 'post', 'report', 'promotion', 'exercise', 'program', 'section', 'meal', 'order') NOT NULL;
