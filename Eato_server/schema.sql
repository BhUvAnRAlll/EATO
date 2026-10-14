-- EATO database schema (MySQL 8.0.16+; CHECK constraints need 8.0.16)
--
-- Run:  mysql -u root -p < schema.sql
--
-- Notes
-- - Sign-in stays with Clerk. users.id is the Clerk user id (e.g. "user_3KaZ..."),
--   so no passwords are stored here.
-- - Money is stored in paise (INT) to avoid rounding errors: ₹249.00 = 24900.
-- - Nutrition values are per serving; grams use DECIMAL(6,1) (e.g. 44.5 g).
-- - Uploaded body composition photos/PDFs are never stored, only the confirmed values.

CREATE DATABASE IF NOT EXISTS eato
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE eato;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- One row per Clerk account. The role decides which dashboard opens after login.
CREATE TABLE users (
  id          VARCHAR(64)  NOT NULL,                 -- Clerk user id
  email       VARCHAR(255) NOT NULL,
  full_name   VARCHAR(120) NULL,
  phone       CHAR(10)     NULL,                     -- 10 digits, +91 implied
  role        ENUM('user', 'admin', 'trainer') NOT NULL DEFAULT 'user',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  CONSTRAINT chk_users_phone CHECK (phone IS NULL OR phone REGEXP '^[0-9]{10}$')
) ENGINE = InnoDB;

-- Answers from the profile setup steps (members only)
CREATE TABLE profiles (
  user_id            VARCHAR(64)  NOT NULL,
  dob                DATE         NULL,
  gender             ENUM('male', 'female', 'other', 'unspecified') NULL,
  goal               ENUM('fat_loss', 'maintenance', 'muscle_gain', 'healthy_eating') NULL,
  height_cm          DECIMAL(5,1) NULL,
  weight_kg          DECIMAL(5,1) NULL,
  body_fat_percent   DECIMAL(4,1) NULL,
  activity           ENUM('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active') NULL,
  health_flags       JSON         NULL,  -- e.g. ["pregnant"]; any flag routes targets to professional guidance
  diet               ENUM('vegetarian', 'non-vegetarian', 'eggetarian', 'vegan') NULL,
  cuisines           JSON         NULL,  -- e.g. ["North Indian", "South Indian"]
  dislikes           VARCHAR(500) NULL,
  allergies          VARCHAR(500) NULL,
  workout_frequency  ENUM('1-2', '3-4', '5-6', '7') NULL,
  workout_type       ENUM('gym', 'home', 'cardio', 'other') NULL,
  workout_time       ENUM('morning', 'afternoon', 'evening') NULL,
  meals_per_day      ENUM('3', '4', '5', '6+') NULL,
  delivery_pincode   CHAR(6)      NULL,
  profile_complete   BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_profiles_height CHECK (height_cm IS NULL OR height_cm BETWEEN 100 AND 250),
  CONSTRAINT chk_profiles_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 25 AND 350),
  CONSTRAINT chk_profiles_body_fat CHECK (body_fat_percent IS NULL OR body_fat_percent BETWEEN 2 AND 75),
  CONSTRAINT chk_profiles_pincode CHECK (delivery_pincode IS NULL OR delivery_pincode REGEXP '^[1-9][0-9]{5}$')
) ENGINE = InnoDB;

-- Which members a trainer coaches (a trainer can't be their own client; checked in the API)
CREATE TABLE trainer_clients (
  trainer_id   VARCHAR(64) NOT NULL,
  client_id    VARCHAR(64) NOT NULL,
  assigned_by  VARCHAR(64) NULL,                    -- the admin who assigned them
  assigned_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trainer_id, client_id),
  KEY idx_trainer_clients_client (client_id),
  CONSTRAINT fk_trainer_clients_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_clients_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_clients_admin FOREIGN KEY (assigned_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Nutrition targets
-- ---------------------------------------------------------------------------

-- Confirmed values from a body composition (BCA) report. Values the user didn't
-- confirm are never saved; NULL means the value wasn't on the report.
CREATE TABLE body_composition_reports (
  id                       CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id                  VARCHAR(64)  NOT NULL,
  source                   ENUM('upload', 'manual') NOT NULL,
  format                   ENUM('inbody') NULL,     -- layout read from (uploads only)
  test_date                DATE         NULL,
  height_cm                DECIMAL(5,1) NULL,
  age                      TINYINT UNSIGNED NULL,
  gender                   ENUM('male', 'female') NULL,
  weight_kg                DECIMAL(5,1) NULL,
  body_fat_mass_kg         DECIMAL(5,1) NULL,
  percent_body_fat         DECIMAL(4,1) NULL,
  fat_free_mass_kg         DECIMAL(5,1) NULL,
  skeletal_muscle_mass_kg  DECIMAL(5,1) NULL,
  printed_bmr_kcal         SMALLINT UNSIGNED NULL,  -- for comparison only, never used as the target
  confirmed_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bca_user_date (user_id, test_date),
  CONSTRAINT fk_bca_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The daily target in use for each member. The calculation is kept beside it, and a
-- trainer's override is never overwritten by recalculating.
CREATE TABLE nutrition_targets (
  user_id             VARCHAR(64)  NOT NULL,
  formula             VARCHAR(40)  NOT NULL,        -- e.g. "eato-calculator"
  config_version      VARCHAR(20)  NOT NULL,
  rmr_formula         ENUM('mifflin_st_jeor', 'katch_mcardle') NULL,  -- NULL = professional/manual pathway
  report_id           CHAR(36)     NULL,            -- BCA report used (Katch–McArdle only)
  inputs              JSON         NOT NULL,        -- calculator inputs at the time
  calculated          JSON         NULL,            -- rmr, tdee, calories and macros from the equation
  calculated_at       TIMESTAMP    NOT NULL,
  calories            SMALLINT UNSIGNED NOT NULL,   -- active target
  protein_g           SMALLINT UNSIGNED NOT NULL,
  carbs_g             SMALLINT UNSIGNED NOT NULL,
  fat_g               SMALLINT UNSIGNED NOT NULL,
  source              ENUM('calculated', 'user_adjusted', 'trainer_adjusted') NOT NULL DEFAULT 'calculated',
  reason              VARCHAR(300) NULL,            -- why it differs from the calculation
  set_by              VARCHAR(64)  NULL,            -- user or trainer who set it
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_targets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_targets_report FOREIGN KEY (report_id) REFERENCES body_composition_reports (id) ON DELETE SET NULL,
  CONSTRAINT fk_targets_set_by FOREIGN KEY (set_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_targets_calories CHECK (calories BETWEEN 800 AND 6000)
) ENGINE = InnoDB;

-- Weigh-ins for the weight log and recalibration suggestions
CREATE TABLE weigh_ins (
  user_id    VARCHAR(64)  NOT NULL,
  logged_on  DATE         NOT NULL,
  weight_kg  DECIMAL(5,1) NOT NULL,
  PRIMARY KEY (user_id, logged_on),               -- one weigh-in per day
  CONSTRAINT fk_weigh_ins_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_weigh_ins_weight CHECK (weight_kg BETWEEN 25 AND 350)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Menu and home screen
-- ---------------------------------------------------------------------------

CREATE TABLE meals (
  id            VARCHAR(64)  NOT NULL,            -- slug, e.g. "grilled-chicken-bowl"
  name          VARCHAR(120) NOT NULL,
  description   VARCHAR(500) NULL,
  image_url     VARCHAR(500) NULL,
  diet          ENUM('vegetarian', 'non-vegetarian', 'eggetarian', 'vegan') NOT NULL,
  calories      SMALLINT UNSIGNED NOT NULL,       -- per serving
  protein_g     DECIMAL(6,1) NOT NULL,
  carbs_g       DECIMAL(6,1) NOT NULL,
  fat_g         DECIMAL(6,1) NOT NULL,
  price_paise   INT UNSIGNED NOT NULL,
  is_popular    BOOLEAN      NOT NULL DEFAULT FALSE,  -- shown under "Popular Meals"
  is_available  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meals_popular (is_available, is_popular)
) ENGINE = InnoDB;

-- Hearted meals
CREATE TABLE favorite_meals (
  user_id     VARCHAR(64) NOT NULL,
  meal_id     VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, meal_id),
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_favorites_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Orders and the nutrition diary
-- ---------------------------------------------------------------------------

-- One order = one delivery (a date + meal slot) to one pincode
CREATE TABLE orders (
  id                CHAR(36)    NOT NULL DEFAULT (UUID()),
  user_id           VARCHAR(64) NOT NULL,
  delivery_date     DATE        NOT NULL,
  meal_slot         ENUM('breakfast', 'lunch', 'snack', 'dinner') NOT NULL,
  delivery_pincode  CHAR(6)     NOT NULL,
  status            ENUM('placed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled') NOT NULL DEFAULT 'placed',
  total_paise       INT UNSIGNED NOT NULL,
  delivered_at      TIMESTAMP   NULL,
  created_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_user_date (user_id, delivery_date),   -- "Today" on the home screen
  KEY idx_orders_status (status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_orders_pincode CHECK (delivery_pincode REGEXP '^[1-9][0-9]{5}$')
) ENGINE = InnoDB;

-- Meals in an order. Name, price and nutrition are copied at order time so later
-- menu changes don't rewrite past orders.
CREATE TABLE order_items (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  order_id          CHAR(36)     NOT NULL,
  meal_id           VARCHAR(64)  NULL,
  meal_name         VARCHAR(120) NOT NULL,
  quantity          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  unit_price_paise  INT UNSIGNED NOT NULL,
  calories          SMALLINT UNSIGNED NOT NULL,      -- per serving
  protein_g         DECIMAL(6,1) NOT NULL,
  carbs_g           DECIMAL(6,1) NOT NULL,
  fat_g             DECIMAL(6,1) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE SET NULL,
  CONSTRAINT chk_order_items_quantity CHECK (quantity BETWEEN 1 AND 20)
) ENGINE = InnoDB;

-- Nutrition diary. Delivered order items are logged automatically (source = 'order');
-- members can also add food themselves. "Today's Nutrition" = sum for today.
CREATE TABLE food_log (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id        VARCHAR(64)  NOT NULL,
  logged_on      DATE         NOT NULL,
  meal_slot      ENUM('breakfast', 'lunch', 'snack', 'dinner') NOT NULL,
  name           VARCHAR(120) NOT NULL,
  servings       DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  calories       SMALLINT UNSIGNED NOT NULL,         -- totals for the servings eaten
  protein_g      DECIMAL(6,1) NOT NULL,
  carbs_g        DECIMAL(6,1) NOT NULL,
  fat_g          DECIMAL(6,1) NOT NULL,
  source         ENUM('order', 'manual', 'barcode', 'photo') NOT NULL,
  order_item_id  CHAR(36)     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_food_log_user_day (user_id, logged_on),
  UNIQUE KEY uq_food_log_order_item (order_item_id),   -- an order item is logged once
  CONSTRAINT fk_food_log_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_food_log_order_item FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE SET NULL,
  CONSTRAINT chk_food_log_servings CHECK (servings > 0)
) ENGINE = InnoDB;

-- Hero promotions on the home screen (the carousel). Admins manage them from the app's
-- admin area. A promotion is shown to members only while status = 'published' and the
-- current time is inside [starts_at, ends_at); NULL means no limit on that side.
-- image_url is "asset:<key>" for an image bundled with the app or an https URL.
-- Buttons can only open screens from the server's allowlist (see home.js).
CREATE TABLE promotions (
  id                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title                      VARCHAR(80)  NOT NULL,            -- admin-facing name
  eyebrow                    VARCHAR(40)  NOT NULL,            -- small uppercase line, e.g. "CHEF-PREPARED"
  headline                   VARCHAR(80)  NOT NULL,
  description                VARCHAR(160) NOT NULL,
  image_url                  VARCHAR(500) NOT NULL,
  image_alt                  VARCHAR(160) NULL,                -- accessibility text for the image
  cta_label                  VARCHAR(30)  NOT NULL,
  cta_action                 ENUM('open_screen') NOT NULL DEFAULT 'open_screen',
  cta_destination            VARCHAR(40)  NOT NULL,            -- screen key from the allowlist
  secondary_cta_label        VARCHAR(30)  NULL,
  secondary_cta_action       ENUM('open_screen') NULL,
  secondary_cta_destination  VARCHAR(40)  NULL,
  text_align                 ENUM('left', 'center') NOT NULL DEFAULT 'left',
  image_position             ENUM('right', 'left') NOT NULL DEFAULT 'right',
  background_color           CHAR(7)      NULL,                -- #RRGGBB, NULL = the page colour
  text_color                 CHAR(7)      NULL,
  status                     ENUM('draft', 'published', 'disabled') NOT NULL DEFAULT 'draft',
  display_order              INT UNSIGNED NOT NULL DEFAULT 0,  -- carousel position, 1 = first
  rotation_interval_seconds  TINYINT UNSIGNED NOT NULL DEFAULT 2,
  starts_at                  DATETIME     NULL,
  ends_at                    DATETIME     NULL,
  created_by                 VARCHAR(64)  NULL,                -- Clerk user id of the admin
  updated_by                 VARCHAR(64)  NULL,
  created_at                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_promotions_active (status, display_order),
  CONSTRAINT chk_promotions_interval CHECK (rotation_interval_seconds BETWEEN 1 AND 30),
  CONSTRAINT chk_promotions_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
) ENGINE = InnoDB;

-- The editable parts of the home screen around the carousel: section headings, action
-- labels, the quick-action cards and which meals appear under "Popular Meals". One row.
-- Members' nutrition numbers and orders are never stored here, only labels and layout.
CREATE TABLE home_content (
  id                      TINYINT UNSIGNED NOT NULL,
  nutrition_heading       VARCHAR(40)  NOT NULL,
  nutrition_action_label  VARCHAR(30)  NOT NULL,
  popular_heading         VARCHAR(40)  NOT NULL,
  popular_action_label    VARCHAR(30)  NOT NULL,
  today_heading           VARCHAR(40)  NOT NULL,
  today_action_label      VARCHAR(30)  NOT NULL,
  show_today_section      BOOLEAN      NOT NULL DEFAULT TRUE,
  quick_actions           JSON         NOT NULL,  -- [{ id, title, subtitle, icon, destination }], icon/destination from the allowlists
  popular_meal_ids        JSON         NOT NULL,  -- ordered meal ids, e.g. ["grilled-chicken-bowl"]
  updated_by              VARCHAR(64)  NULL,
  updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_home_content_single CHECK (id = 1)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Starting content for the home screen (admins change it from the app)
-- ---------------------------------------------------------------------------

INSERT INTO meals (id, name, description, image_url, diet, calories, protein_g, carbs_g, fat_g, price_paise, is_popular) VALUES
  ('grilled-chicken-bowl', 'Grilled Chicken Bowl', 'Grilled chicken, quinoa, broccoli and roasted sweet potato.', 'asset:meal-grilled-chicken', 'non-vegetarian', 470, 44, 38, 14, 29900, TRUE),
  ('paneer-tikka-bowl', 'Paneer Tikka Bowl', 'Tandoori paneer with brown rice and charred vegetables.', 'asset:meal-paneer-tikka', 'vegetarian', 540, 32, 58, 18, 27900, TRUE),
  ('salmon-bowl', 'Salmon Bowl', 'Grilled salmon, greens, avocado and lemon.', 'asset:meal-salmon', 'non-vegetarian', 560, 42, 48, 20, 34900, TRUE),
  ('lemon-herb-chicken-bowl', 'Lemon Herb Chicken Bowl', 'Lemon herb chicken with quinoa and roasted vegetables.', 'asset:meal-lemon-herb-chicken', 'non-vegetarian', 470, 44, 38, 14, 29900, FALSE);

INSERT INTO home_content (id, nutrition_heading, nutrition_action_label, popular_heading, popular_action_label, today_heading, today_action_label, show_today_section, quick_actions, popular_meal_ids) VALUES
  (1, 'Today''s Nutrition', 'Edit Goal', 'Popular Meals', 'View all', 'Today', 'View all', TRUE,
   '[{"id":"meals","title":"Meals","subtitle":"Browse menu","icon":"meals","destination":"explore"},{"id":"plans","title":"Plans","subtitle":"For your goals","icon":"plans","destination":"plans"},{"id":"nutrition","title":"Nutrition","subtitle":"Track intake","icon":"nutrition","destination":"nutrition"},{"id":"delivery","title":"Delivery","subtitle":"At your doorstep","icon":"delivery","destination":"orders"}]',
   '["grilled-chicken-bowl","paneer-tikka-bowl","salmon-bowl"]');

INSERT INTO promotions (title, eyebrow, headline, description, image_url, image_alt, cta_label, cta_destination, status, display_order) VALUES
  ('Chef-prepared meals', 'CHEF-PREPARED', 'Healthy meals for a stronger you', 'Nutritious, chef-prepared meals delivered to your doorstep.', 'asset:hero-bowl', 'Grilled chicken bowl with vegetables', 'Order Now', 'explore', 'published', 1),
  ('Your fitness, your food', 'YOUR FITNESS, YOUR FOOD', 'Eat better. Reach your goals.', 'Delicious meals designed around your nutrition targets.', 'asset:hero-nutrition', 'Fresh ingredients on a board', 'Explore Meals', 'explore', 'published', 2),
  ('Fuel your day', 'FUEL YOUR DAY', 'Better nutrition starts here', 'Find meals that fit your lifestyle and daily macros.', 'asset:hero-delivery', 'Packed EATO meal boxes', 'View Menu', 'explore', 'published', 3);
