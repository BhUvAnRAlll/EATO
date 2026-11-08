-- justFit database schema (MySQL 8.0.16+; CHECK constraints need 8.0.16)
--
-- Run:  mysql -u root -p < schema.sql
--
-- Notes
-- - Sign-in is a phone number and a texted code (auth/): no passwords exist, codes and session
--   tokens are stored only as hashes (otp_challenges, auth_sessions). users.id is "user_..."
-- - Money is stored in paise (INT) to avoid rounding errors: ₹249.00 = 24900.
-- - Nutrition values are per serving; grams use DECIMAL(6,1) (e.g. 44.5 g).
-- - Uploaded body composition photos/PDFs are never stored, only the confirmed values.

CREATE DATABASE IF NOT EXISTS justfit
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE justfit;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- One row per account (signed in with a phone and a code since 2026-11-01). The role decides
-- which dashboard opens after login: user (member), admin (Super Admin), gym_admin (the gym
-- admin portal, 2026-11-04; also a gym's Staff), trainer (a gym's PT trainer: the member app,
-- 2026-11-05).
CREATE TABLE users (
  id                 VARCHAR(64)  NOT NULL,          -- user_ + random base62 (Clerk ids before 2026-11-01 keep theirs)
  email              VARCHAR(255) NULL,              -- optional: phone sign-in needs none
  full_name          VARCHAR(120) NULL,
  phone              CHAR(10)     NULL,              -- 10 digits, +91 implied
  phone_verified_at  DATETIME     NULL,              -- set when a sign-in code proved the phone
  verified_phone     CHAR(10)     AS (IF(phone_verified_at IS NULL, NULL, phone)) VIRTUAL,  -- the login
  role               ENUM('user', 'admin', 'gym_admin', 'trainer') NOT NULL DEFAULT 'user',
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_verified_phone (verified_phone),  -- one account per verified phone
  KEY idx_users_role (role),
  CONSTRAINT chk_users_phone CHECK (phone IS NULL OR phone REGEXP '^[0-9]{10}$'),
  CONSTRAINT chk_users_phone_verified CHECK (phone_verified_at IS NULL OR phone IS NOT NULL)
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

-- The daily target in use for each member. The calculation is kept beside it.
CREATE TABLE nutrition_targets (
  user_id             VARCHAR(64)  NOT NULL,
  formula             VARCHAR(40)  NOT NULL,        -- e.g. "justfit-calculator"
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
  source              ENUM('calculated', 'user_adjusted') NOT NULL DEFAULT 'calculated',
  reason              VARCHAR(300) NULL,            -- why it differs from the calculation
  set_by              VARCHAR(64)  NULL,            -- the member who set it
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
  created_by                 VARCHAR(64)  NULL,                -- user id of the admin
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
  (1, 'Today''s Macros', 'Edit Goal', 'Popular Meals', 'View all', 'Today', 'View all', TRUE,
   '[]',
   '["grilled-chicken-bowl","paneer-tikka-bowl","salmon-bowl"]');

INSERT INTO promotions (title, eyebrow, headline, description, image_url, image_alt, cta_label, cta_destination, status, display_order) VALUES
  ('Chef-prepared meals', 'CHEF-PREPARED', 'Healthy meals for a stronger you', 'Nutritious, chef-prepared meals delivered to your doorstep.', 'asset:hero-bowl', 'Grilled chicken bowl with vegetables', 'Order Now', 'explore', 'published', 1),
  ('Your fitness, your food', 'YOUR FITNESS, YOUR FOOD', 'Eat better. Reach your goals.', 'Delicious meals designed around your nutrition targets.', 'asset:hero-nutrition', 'Fresh ingredients on a board', 'Explore Meals', 'explore', 'published', 2),
  ('Fuel your day', 'FUEL YOUR DAY', 'Better nutrition starts here', 'Find meals that fit your lifestyle and daily macros.', 'asset:hero-delivery', 'Packed justFit meal boxes', 'View Menu', 'explore', 'published', 3);

-- ---------------------------------------------------------------------------
-- Macro diary
-- ---------------------------------------------------------------------------

-- Macro diary: the meals and water a member logs for themselves. Separate from the
-- delivery menu (`meals`) and from `food_log` (kept for logging delivered orders).
-- Every row belongs to one member and is only ever read or changed by that member.

-- A logged meal. Its totals are always summed from its items, never stored here.
CREATE TABLE macro_meal_logs (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  log_date    DATE         NOT NULL,                  -- the member's local day
  slot        ENUM('breakfast', 'lunch', 'snack', 'dinner') NOT NULL,
  title       VARCHAR(120) NOT NULL,
  logged_at   TIMESTAMP(3) NOT NULL,                  -- when it was eaten; orders the day
  source      ENUM('manual', 'favorite', 'repeat', 'plan') NOT NULL DEFAULT 'manual',
  plan_log_key VARCHAR(80) NULL,                      -- "<date>:<plan meal id>:<n>" for a diet-plan meal, so a repeated tap can't log it twice
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_logs_plan_key (user_id, plan_log_key),
  KEY idx_meal_logs_user_day (user_id, log_date, logged_at),
  KEY idx_meal_logs_user_recent (user_id, logged_at),
  CONSTRAINT fk_meal_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The foods inside a logged meal, in the order they were entered
CREATE TABLE macro_meal_items (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  macro_meal_id  CHAR(36)          NOT NULL,
  user_id      VARCHAR(64)       NOT NULL,
  position     TINYINT UNSIGNED  NOT NULL,
  name         VARCHAR(120)      NOT NULL,
  quantity     DECIMAL(7,2)      NOT NULL,
  unit         VARCHAR(40)       NOT NULL,
  kcal         DECIMAL(6,1)      NOT NULL,
  protein_g    DECIMAL(6,1)      NOT NULL,
  carbs_g      DECIMAL(6,1)      NOT NULL,
  fat_g        DECIMAL(6,1)      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_meal_log_items_meal (macro_meal_id, position),
  CONSTRAINT fk_meal_log_items_meal FOREIGN KEY (macro_meal_id) REFERENCES macro_meal_logs (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_log_items_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_meal_log_items_quantity CHECK (quantity > 0 AND quantity <= 10000),
  CONSTRAINT chk_meal_log_items_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_meal_log_items_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;

-- Foods a member hearted. `source_key` (e.g. "meal:<id>") makes the heart a toggle;
-- a favourite saved without one is always a new row (NULLs don't collide in a UNIQUE key).
CREATE TABLE macro_favorite_foods (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  name        VARCHAR(120) NOT NULL,
  items       JSON         NOT NULL,                  -- same shape as macro_meal_items
  source_key  VARCHAR(80)  NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_favorite_foods_source (user_id, source_key),
  KEY idx_favorite_foods_user (user_id, created_at),
  CONSTRAINT fk_favorite_foods_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One glass, bottle or custom amount of water
CREATE TABLE macro_water_logs (
  id          CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)       NOT NULL,
  log_date    DATE              NOT NULL,
  amount_ml   SMALLINT UNSIGNED NOT NULL,
  logged_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source      ENUM('quick_add', 'custom', 'workout') NOT NULL DEFAULT 'quick_add',
  label       VARCHAR(40)       NULL,
  PRIMARY KEY (id),
  KEY idx_water_logs_user_day (user_id, log_date, logged_at),
  CONSTRAINT fk_water_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_water_logs_amount CHECK (amount_ml BETWEEN 10 AND 3000)
) ENGINE = InnoDB;

-- A day's water target, written once on the first log of that day so it never shifts
-- afterwards (only a recorded workout changes it). consumed_ml is a cache of the entries.
CREATE TABLE macro_hydration_days (
  user_id                     VARCHAR(64)       NOT NULL,
  log_date                    DATE              NOT NULL,
  target_ml                   SMALLINT UNSIGNED NOT NULL,
  base_target_ml              SMALLINT UNSIGNED NOT NULL,
  activity_adjustment_ml      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  workout_adjustment_ml       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  environmental_adjustment_ml SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_ml                 INT UNSIGNED      NOT NULL DEFAULT 0,
  workout_minutes             SMALLINT UNSIGNED NULL,
  workout_intensity           ENUM('light', 'moderate', 'high') NULL,
  used_fallbacks              BOOLEAN           NOT NULL DEFAULT FALSE,
  calc_version                VARCHAR(20)       NOT NULL,
  updated_at                  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, log_date),
  CONSTRAINT fk_hydration_days_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Hydration reminder settings, one row per member (defaults: on, every 2 hours, 08:00–20:00)
CREATE TABLE macro_hydration_preferences (
  user_id            VARCHAR(64)      NOT NULL,
  reminders_enabled  BOOLEAN          NOT NULL DEFAULT TRUE,
  interval_hours     TINYINT UNSIGNED NOT NULL DEFAULT 2,
  start_hour         TINYINT UNSIGNED NOT NULL DEFAULT 8,
  end_hour           TINYINT UNSIGNED NOT NULL DEFAULT 20,
  updated_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_hydration_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_hydration_preferences_interval CHECK (interval_hours BETWEEN 1 AND 12),
  CONSTRAINT chk_hydration_preferences_window CHECK (start_hour <= 23 AND end_hour <= 23 AND end_hour > start_hour)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Workout: generated training plans, what members actually did, and the exercise
-- library behind them. Plans come from the engine in JustFit_client/src/lib/workout
-- (deterministic arithmetic, no AI). Every member row is only read or changed by
-- that member; library rows are written by admins only.
--
-- Every member row hangs directly off users. Deleting a member must remove every workout
-- row of theirs, and MySQL 9.7.0 (InnoDB) gets a deeper chain wrong: with users > plans >
-- days > exercises and two or more plans, only the first plan's days and exercises are
-- cascaded; the rest are orphaned (reproduced on plain three-level tables, see
-- __tests__/e2e/workout-schema.e2e.test.js). So the only ON DELETE CASCADE in these tables is
-- user_id > users, one level deep. The structural links (plan_id, day_id, log_id,
-- day_exercise_id, created_by) are indexed columns the server fills from the parent row and
-- checks on every write, not foreign keys; plans are superseded, never deleted on their own.
-- ---------------------------------------------------------------------------

-- The exercise library. Built-in rows are kept in step with JustFit_client/src/lib/workout/
-- library.ts by name; admins add their own. A row is archived, never deleted, so plans
-- that already use it keep resolving. Names are unique case-insensitively (the default
-- collation), and the engine fields are required: a row it cannot place is never programmed.
CREATE TABLE workout_exercise_library (
  id                  CHAR(36)          NOT NULL DEFAULT (UUID()),
  name                VARCHAR(80)       NOT NULL,
  muscle_group        ENUM('legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'full_body', 'cardio') NOT NULL,
  equipment           VARCHAR(60)       NULL,
  pattern             ENUM('squat', 'hinge', 'lunge', 'knee_flexion', 'knee_extension', 'calf',
                           'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
                           'elbow_flexion', 'elbow_extension', 'shoulder_abduction', 'rear_delt',
                           'core', 'conditioning', 'warmup', 'stretch') NOT NULL,
  difficulty          TINYINT UNSIGNED  NOT NULL,     -- 1-3: complexity, stability, skill, loading (not effort)
  high_risk           BOOLEAN           NOT NULL DEFAULT FALSE,
  low_impact          BOOLEAN           NOT NULL DEFAULT TRUE,
  machine             BOOLEAN           NOT NULL DEFAULT FALSE,
  region              ENUM('lower', 'upper', 'any') NOT NULL DEFAULT 'any',
  timed_sec           SMALLINT UNSIGNED NULL,         -- held or timed work: the base seconds
  instructions        JSON              NULL,         -- up to 10 lines of up to 200 characters
  video_key           VARCHAR(200)      NULL,         -- the demo clip in storage (NULL: no video yet)
  video_uploaded_at   TIMESTAMP         NULL,
  built_in            BOOLEAN           NOT NULL DEFAULT FALSE,
  ai_drafted          BOOLEAN           NOT NULL DEFAULT FALSE,  -- written by the AI for Admin › Exercises
  created_by          VARCHAR(64)       NULL,         -- set on admin-authored rows only
  archived_at         TIMESTAMP         NULL,
  created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_library_name (name),
  KEY idx_workout_library_group (muscle_group, name),
  KEY idx_workout_library_pattern (pattern, difficulty),
  CONSTRAINT fk_workout_library_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_workout_library_difficulty CHECK (difficulty BETWEEN 1 AND 3),
  CONSTRAINT chk_workout_library_timed CHECK (timed_sec IS NULL OR timed_sec BETWEEN 1 AND 3600)
) ENGINE = InnoDB;

-- The Fitness tab's categories ("sections"), in the admin's order: six built in (renamed, reordered
-- or hidden, never deleted) and any the admin creates (deleted only while they have no programs).
-- fitness/programs.js adds the six the first time programs are read; the migration adds them too.
CREATE TABLE fitness_sections (
  slug         VARCHAR(40)       NOT NULL,
  title        VARCHAR(40)       NOT NULL,
  note         VARCHAR(120)      NOT NULL DEFAULT '',
  layout       ENUM('poster', 'tile', 'wide') NOT NULL DEFAULT 'tile',  -- how its cards look
  position     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  published    BOOLEAN           NOT NULL DEFAULT TRUE,
  built_in     BOOLEAN           NOT NULL DEFAULT FALSE,
  created_by   VARCHAR(64)       NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (slug),
  KEY idx_fitness_sections_position (position),
  CONSTRAINT fk_fitness_sections_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- The Fitness tab's free programs (migrations/2026-11-09-fitness-programs.sql): sections of
-- programs made of sessions of library exercises. No cascades: fitness/programs.js deletes children.
CREATE TABLE fitness_programs (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  slug         VARCHAR(60)       NOT NULL,
  title        VARCHAR(60)       NOT NULL,
  subtitle     VARCHAR(120)      NOT NULL DEFAULT '',
  description  VARCHAR(600)      NOT NULL DEFAULT '',
  section      VARCHAR(40)       NOT NULL,  -- a fitness_sections slug (its category)
  place        ENUM('home', 'center', 'both') NOT NULL DEFAULT 'both',
  level        ENUM('beginner', 'intermediate', 'advanced') NOT NULL DEFAULT 'beginner',
  kit          ENUM('none', 'some', 'full_gym') NOT NULL DEFAULT 'none',
  icon         VARCHAR(20)       NOT NULL DEFAULT 'strength',
  palette      VARCHAR(20)       NOT NULL DEFAULT 'lavender',
  cover_key    VARCHAR(64)       NULL,      -- the cover photo's file (fitness/covers.js); NULL: the palette's gradient
  cover_updated_at TIMESTAMP(3)  NULL,      -- when the cover last changed (its URL carries it, so caches never show an old one)
  hero_key     VARCHAR(64)       NULL,      -- the program page's photo (fitness/covers.js), separate from the card's cover; NULL: the gradient
  hero_updated_at TIMESTAMP(3)   NULL,      -- when the page photo last changed (its URL carries it, like the cover's)
  youtube_kind ENUM('playlist', 'video') NULL, -- a YouTube playlist or one video members follow along with (fitness/rules.js youtubeLink)
  youtube_id   VARCHAR(64)       NULL,      -- its ID; both NULL: none (never one without the other)
  youtube_channel VARCHAR(100)   NULL,      -- the creator credited under the player (from the YouTube API)
  videos_synced_at TIMESTAMP     NULL,      -- when the videos were last loaded; older than 30 days: not shown, then deleted
  position     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  published    BOOLEAN           NOT NULL DEFAULT TRUE,
  built_in     BOOLEAN           NOT NULL DEFAULT FALSE,
  ai_drafted   BOOLEAN           NOT NULL DEFAULT FALSE,
  created_by   VARCHAR(64)       NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fitness_programs_slug (slug),
  KEY idx_fitness_programs_section (section, position),
  CONSTRAINT fk_fitness_programs_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_fitness_programs_section FOREIGN KEY (section) REFERENCES fitness_sections (slug) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_fitness_programs_youtube CHECK ((youtube_kind IS NULL) = (youtube_id IS NULL))
) ENGINE = InnoDB;

-- A program's YouTube videos (fitness/youtube.js), in playlist order: each one a session members
-- play and tick off. Replaced whenever the admin saves a new link or presses Refresh videos.
CREATE TABLE fitness_program_videos (
  program_id  CHAR(36)          NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL,
  video_id    VARCHAR(11)       NOT NULL,  -- YouTube's video ID
  title       VARCHAR(200)      NOT NULL DEFAULT '',
  seconds     INT UNSIGNED      NOT NULL DEFAULT 0,
  PRIMARY KEY (program_id, position),
  UNIQUE KEY uq_fitness_videos_video (program_id, video_id),
  CONSTRAINT fk_fitness_videos_program FOREIGN KEY (program_id) REFERENCES fitness_programs (id)
) ENGINE = InnoDB;

-- The videos a member ticked done, by video (so a refreshed playlist keeps the ticks of videos
-- still in it). Goes with the member's account.
CREATE TABLE fitness_video_progress (
  user_id     VARCHAR(64)       NOT NULL,
  program_id  CHAR(36)          NOT NULL,
  video_id    VARCHAR(11)       NOT NULL,
  done_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, program_id, video_id),
  KEY idx_fitness_video_progress_program (program_id),
  CONSTRAINT fk_fitness_video_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_fitness_video_progress_program FOREIGN KEY (program_id) REFERENCES fitness_programs (id)
) ENGINE = InnoDB;

CREATE TABLE fitness_program_sessions (
  id          CHAR(36)          NOT NULL DEFAULT (UUID()),
  program_id  CHAR(36)          NOT NULL,
  position    TINYINT UNSIGNED  NOT NULL,
  title       VARCHAR(60)       NOT NULL,
  minutes     SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  youtube_id  VARCHAR(11)       NULL,      -- a YouTube video members play in the session (embedded only, never uploaded); NULL: none
  youtube_channel VARCHAR(100)  NULL,      -- its creator, credited under the player (from the YouTube API; hidden after 30 days)
  youtube_synced_at TIMESTAMP   NULL,      -- when the channel was last read from YouTube
  PRIMARY KEY (id),
  UNIQUE KEY uq_fitness_sessions_order (program_id, position),
  CONSTRAINT fk_fitness_sessions_program FOREIGN KEY (program_id) REFERENCES fitness_programs (id),
  CONSTRAINT chk_fitness_sessions_minutes CHECK (minutes BETWEEN 5 AND 180)
) ENGINE = InnoDB;

CREATE TABLE fitness_program_exercises (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  session_id   CHAR(36)          NOT NULL,
  program_id   CHAR(36)          NOT NULL,
  exercise_id  CHAR(36)          NOT NULL,
  section      ENUM('warmup', 'workout', 'cooldown') NOT NULL,
  position     TINYINT UNSIGNED  NOT NULL,
  sets         JSON              NOT NULL,
  rest_sec     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  role         ENUM('main', 'secondary', 'isolation', 'conditioning', 'warmup', 'stretch') NULL,
  reps_min     TINYINT UNSIGNED  NULL,
  reps_max     TINYINT UNSIGNED  NULL,
  note         VARCHAR(160)      NULL,
  PRIMARY KEY (id),
  KEY idx_fitness_exercises_session (session_id, position),
  KEY idx_fitness_exercises_program (program_id),
  CONSTRAINT fk_fitness_exercises_session FOREIGN KEY (session_id) REFERENCES fitness_program_sessions (id),
  CONSTRAINT fk_fitness_exercises_exercise FOREIGN KEY (exercise_id) REFERENCES workout_exercise_library (id),
  CONSTRAINT chk_fitness_exercises_rest CHECK (rest_sec <= 600)
) ENGINE = InnoDB;

-- The answers the engine reads, one row per member: what Preferences and "Rebuild my
-- plan" saved. Each one is NULL until asked. They shape training only: the setup profile
-- (profiles) stays the source for nutrition and is never written by the workout feature.
CREATE TABLE workout_profiles (
  user_id         VARCHAR(64)       NOT NULL,
  gender          ENUM('female', 'male', 'other') NULL,
  age_years       TINYINT UNSIGNED  NULL,
  weight_kg       DECIMAL(4,1)      NULL,
  height_cm       SMALLINT UNSIGNED NULL,
  body_type       ENUM('lean', 'athletic', 'average', 'overweight', 'obese') NULL,
  goal            ENUM('lose_weight', 'build_muscle', 'get_fitter', 'stay_healthy') NULL,
  experience      ENUM('beginner', 'intermediate', 'advanced') NULL,
  weekdays        JSON              NULL,             -- chosen training days, 0 = Sunday
  pace            ENUM('slow', 'standard', 'brisk') NULL,
  fitness_base    TINYINT UNSIGNED  NULL,
  squat_score     TINYINT UNSIGNED  NULL,
  push_score      TINYINT UNSIGNED  NULL,
  pull_score      TINYINT UNSIGNED  NULL,
  serious_injury  BOOLEAN           NULL,
  split           ENUM('auto', 'full_body', 'upper_lower', 'push_pull_legs') NULL,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  home_equipment  ENUM('none', 'some', 'home_gym') NULL,             -- the Fitness tab's location sheet
  center_equipment ENUM('free_weights', 'basic_gym', 'full_gym') NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_workout_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_profiles_age CHECK (age_years IS NULL OR age_years BETWEEN 13 AND 100),
  CONSTRAINT chk_workout_profiles_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 25 AND 300),
  CONSTRAINT chk_workout_profiles_height CHECK (height_cm IS NULL OR height_cm BETWEEN 100 AND 250),
  CONSTRAINT chk_workout_profiles_scores CHECK (
    (fitness_base IS NULL OR fitness_base BETWEEN 1 AND 4) AND (squat_score IS NULL OR squat_score BETWEEN 1 AND 4) AND
    (push_score IS NULL OR push_score BETWEEN 1 AND 4) AND (pull_score IS NULL OR pull_score BETWEEN 1 AND 4))
) ENGINE = InnoDB;

-- A member's weekly programme: a snapshot of one engine run, stamped with what produced it.
-- One active plan per member; a regenerated plan supersedes the old one, which is kept.
CREATE TABLE workout_plans (
  id                            CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id                       VARCHAR(64)       NOT NULL,
  name                          VARCHAR(80)       NOT NULL,
  goal                          ENUM('lose_weight', 'build_muscle', 'get_fitter', 'stay_healthy') NOT NULL,
  level                         ENUM('beginner', 'intermediate', 'advanced') NOT NULL,
  days_per_week                 TINYINT UNSIGNED  NOT NULL,
  split                         ENUM('auto', 'full_body', 'upper_lower', 'push_pull_legs') NOT NULL DEFAULT 'auto',
  source                        ENUM('engine', 'member') NOT NULL DEFAULT 'engine',
  status                        ENUM('active', 'superseded', 'archived') NOT NULL DEFAULT 'active',
  engine_version                SMALLINT UNSIGNED NULL,
  input_hash                    CHAR(8)           NULL,
  inputs_snapshot               JSON              NULL,
  calibration                   JSON              NULL,
  requires_professional_review  BOOLEAN           NOT NULL DEFAULT FALSE,
  start_date                    DATE              NULL,
  -- Equals user_id only while active, so a member can never have two active plans. Virtual
  -- (indexed, not stored): MySQL forbids ON DELETE CASCADE on the base of a stored column.
  active_user_id                VARCHAR(64)       AS (IF(status = 'active', user_id, NULL)) VIRTUAL,
  created_at                    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_plans_one_active (active_user_id),
  KEY idx_workout_plans_user_status (user_id, status),
  CONSTRAINT fk_workout_plans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_plans_days CHECK (days_per_week BETWEEN 1 AND 7)
) ENGINE = InnoDB;

-- One training day of a plan, pinned to a weekday (0 = Sunday), not to a date
CREATE TABLE workout_days (
  id            CHAR(36)          NOT NULL DEFAULT (UUID()),
  plan_id       CHAR(36)          NOT NULL,
  user_id       VARCHAR(64)       NOT NULL,
  weekday       TINYINT UNSIGNED  NOT NULL,
  title         VARCHAR(60)       NOT NULL,
  session_type  VARCHAR(20)       NULL,             -- full_body, upper, lower, push, pull, legs
  variant_of    CHAR(36)          NULL,             -- an adapted day (At home / At center): the plan day it adapts
  place         ENUM('home', 'center') NULL,        -- the adapted day's place; NULL for the plan's own days
  program_session_id CHAR(36)     NULL,             -- a Fitness program session done on a date (fitness/programs.js)
  retired_at    TIMESTAMP         NULL,             -- an adapted day kept for the history after the equipment changed; never reused
  place_key     VARCHAR(48)       AS (IF(retired_at IS NULL, COALESCE(place, program_session_id, 'plan'), CONCAT('retired:', id))) STORED,
  created_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_days_plan_weekday_place (plan_id, weekday, place_key),
  KEY idx_workout_days_user (user_id),
  KEY idx_workout_days_variant (variant_of, place),
  CONSTRAINT fk_workout_days_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_days_weekday CHECK (weekday BETWEEN 0 AND 6)
) ENGINE = InnoDB;

-- An exercise inside a day, with its prescribed sets and rest. `sets` is a JSON array of
-- { reps?, durationSec?, weightKg? }; the engine never sets weightKg. `note` carries the
-- engine's own explanation when it had to substitute.
CREATE TABLE workout_day_exercises (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  day_id       CHAR(36)          NOT NULL,
  plan_id      CHAR(36)          NOT NULL,
  user_id      VARCHAR(64)       NOT NULL,
  exercise_id  CHAR(36)          NOT NULL,
  section      ENUM('warmup', 'workout', 'cooldown') NOT NULL,
  position     TINYINT UNSIGNED  NOT NULL,
  sets         JSON              NOT NULL,
  rest_sec     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  role         ENUM('main', 'secondary', 'isolation', 'conditioning', 'warmup', 'stretch') NULL,
  reps_min     TINYINT UNSIGNED  NULL,
  reps_max     TINYINT UNSIGNED  NULL,
  note         VARCHAR(160)      NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workout_day_exercises_order (day_id, section, position),
  KEY idx_workout_day_exercises_plan (plan_id),
  KEY idx_workout_day_exercises_user (user_id),
  CONSTRAINT fk_workout_day_exercises_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_day_exercises_exercise FOREIGN KEY (exercise_id) REFERENCES workout_exercise_library (id),
  CONSTRAINT chk_workout_day_exercises_rest CHECK (rest_sec <= 600)
) ENGINE = InnoDB;

-- "On this date, run that day": all that moving a missed session or swapping two days writes
CREATE TABLE workout_day_overrides (
  user_id     VARCHAR(64)  NOT NULL,
  on_date     DATE         NOT NULL,                -- the member's local day
  day_id      CHAR(36)     NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, on_date),
  KEY idx_workout_overrides_day (day_id),
  CONSTRAINT fk_workout_overrides_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One attempt at a day: what happened, separate from the plan (the intention)
CREATE TABLE workout_logs (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id       VARCHAR(64)  NOT NULL,
  plan_id       CHAR(36)     NULL,
  day_id        CHAR(36)     NULL,
  on_date       DATE         NOT NULL,                -- the member's local day
  started_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at  TIMESTAMP(3) NULL,
  status        ENUM('in_progress', 'completed', 'abandoned') NOT NULL DEFAULT 'in_progress',
  -- Set only while in progress, so a member can never have two running logs for one date.
  -- Virtual for the same reason as workout_plans.active_user_id.
  running_key   VARCHAR(80)  AS (IF(status = 'in_progress', CONCAT(user_id, '|', on_date), NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_logs_running (running_key),
  KEY idx_workout_logs_user_date (user_id, on_date),
  KEY idx_workout_logs_day (day_id),
  CONSTRAINT fk_workout_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One completed set inside a log. Unique per (log, exercise, set), so redoing a set
-- replaces it rather than adding a second row.
CREATE TABLE workout_set_logs (
  id               CHAR(36)          NOT NULL DEFAULT (UUID()),
  log_id           CHAR(36)          NOT NULL,
  user_id          VARCHAR(64)       NOT NULL,
  day_exercise_id  CHAR(36)          NOT NULL,
  set_index        TINYINT UNSIGNED  NOT NULL,
  reps             SMALLINT UNSIGNED NULL,
  weight_kg        DECIMAL(5,1)      NULL,
  duration_sec     SMALLINT UNSIGNED NULL,
  completed_at     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_set_logs_set (log_id, day_exercise_id, set_index),
  KEY idx_workout_set_logs_exercise (day_exercise_id),
  KEY idx_workout_set_logs_user (user_id),
  CONSTRAINT fk_workout_set_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_workout_set_logs_values CHECK (
    (reps IS NULL OR reps <= 1000) AND (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 1000)) AND
    (duration_sec IS NULL OR duration_sec <= 3600))
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Super Admin portal (migrations/2026-10-28-admin-portal.sql)
-- ---------------------------------------------------------------------------

-- Every admin action: who, what, on which thing, and a one-line summary for the Overview
CREATE TABLE admin_audit_log (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  admin_id     VARCHAR(64)  NULL,
  action       VARCHAR(40)  NOT NULL,                -- e.g. promotion.publish
  target_type  ENUM('user', 'gym', 'post', 'report', 'promotion', 'exercise', 'program', 'section') NOT NULL,
  target_id    VARCHAR(64)  NULL,
  summary      VARCHAR(200) NOT NULL,                -- "Verified Marcus Johnson", shown as written
  created_at   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),  -- sub-second, so actions keep their order
  PRIMARY KEY (id),
  KEY idx_admin_audit_recent (created_at),
  KEY idx_admin_audit_target (target_type, target_id),
  CONSTRAINT fk_admin_audit_admin FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- ---- AI Coach: the intake ----

-- One row per member: their AI coach intake answers (goal, schedule, where they train, what to
-- work around, food habits, the coach they picked). Read by the coach on the server only. The
-- member's account going takes the row with it.
CREATE TABLE coach_profiles (
  user_id                 VARCHAR(64)       NOT NULL,
  goal                    ENUM('build_muscle', 'lose_weight', 'get_stronger', 'endurance', 'stay_active', 'flexibility', 'sport', 'comeback') NOT NULL,
  experience              ENUM('beginner', 'returning', 'intermediate', 'advanced', 'expert') NOT NULL,
  currently_training      BOOLEAN           NOT NULL,
  weekdays                JSON              NOT NULL,  -- training days, 0 = Sunday (as workout_profiles)
  session_minutes         TINYINT UNSIGNED  NOT NULL,
  main_spot               ENUM('gym', 'home', 'outdoors', 'travel', 'other') NOT NULL,
  backup_spot             ENUM('gym', 'home', 'outdoors', 'travel', 'other') NULL,
  main_equipment          ENUM('none', 'some', 'home_gym', 'full_gym', 'basic_gym', 'free_weights') NOT NULL,
  backup_equipment        ENUM('none', 'some', 'home_gym', 'full_gym', 'basic_gym', 'free_weights') NULL,
  joints                  JSON              NOT NULL,  -- joints to protect, e.g. ["knees"]
  conditions              JSON              NOT NULL,  -- e.g. ["diabetes"]; any one makes the coach cautious
  limitation_notes        VARCHAR(300)      NULL,
  cooking_time            ENUM('none', 'quick', 'medium', 'long') NOT NULL,
  food_budget             ENUM('low', 'medium', 'high') NOT NULL,
  stress                  ENUM('low', 'moderate', 'high') NULL,
  sleep                   ENUM('under_5', '5_6', '7_8', 'over_8') NULL,
  coach                   ENUM('arjun', 'priya', 'rohan', 'meera', 'aditya') NOT NULL,
  coach_style             ENUM('supportive', 'motivational', 'direct', 'analytical', 'funny') NOT NULL,
  plan_notes              VARCHAR(500)      NULL,
  disclaimer_accepted_at  TIMESTAMP         NOT NULL,  -- "Fitness guidance, not medical advice"
  created_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_coach_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_coach_profiles_minutes CHECK (session_minutes IN (15, 20, 30, 45, 60, 75))
) ENGINE = InnoDB;

-- ---- AI Coach: the plan ----

-- One active coach plan per member (older ones are kept as superseded). The targets are the
-- member's nutrition targets when the plan was made; the workout itself lives in workout_plans.
CREATE TABLE coach_plans (
  id               CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id          VARCHAR(64)       NOT NULL,
  coach            ENUM('arjun', 'priya', 'rohan', 'meera', 'aditya') NOT NULL,
  message          VARCHAR(1000)     NOT NULL,  -- the coach's note about the plan
  workout_plan_id  CHAR(36)          NULL,      -- the workout_plans row made with it
  calories         SMALLINT UNSIGNED NOT NULL,
  protein_g        SMALLINT UNSIGNED NOT NULL,
  carbs_g          SMALLINT UNSIGNED NOT NULL,
  fat_g            SMALLINT UNSIGNED NOT NULL,
  status           ENUM('active', 'superseded') NOT NULL DEFAULT 'active',
  active_user      VARCHAR(64)       AS (IF(status = 'active', user_id, NULL)) VIRTUAL,
  created_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coach_plans_one_active (active_user),
  KEY idx_coach_plans_user (user_id, status),
  CONSTRAINT fk_coach_plans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The plan's five meals: breakfast, morning snack, lunch, evening snack, dinner
CREATE TABLE coach_plan_meals (
  id         CHAR(36)         NOT NULL DEFAULT (UUID()),
  plan_id    CHAR(36)         NOT NULL,
  user_id    VARCHAR(64)      NOT NULL,
  slot       ENUM('breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner') NOT NULL,
  name       VARCHAR(120)     NOT NULL,
  meal_time  TIME             NOT NULL,
  note       VARCHAR(300)     NULL,
  position   TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coach_plan_meals_slot (plan_id, slot),
  KEY idx_coach_plan_meals_user (user_id),
  CONSTRAINT fk_coach_plan_meals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The foods in each meal, with the portion and its calories and macros
CREATE TABLE coach_plan_meal_items (
  id         CHAR(36)          NOT NULL DEFAULT (UUID()),
  meal_id    CHAR(36)          NOT NULL,
  plan_id    CHAR(36)          NOT NULL,
  user_id    VARCHAR(64)       NOT NULL,
  position   TINYINT UNSIGNED  NOT NULL,
  name       VARCHAR(120)      NOT NULL,
  quantity   DECIMAL(7,2)      NOT NULL,
  unit       VARCHAR(40)       NOT NULL,
  kcal       DECIMAL(6,1)      NOT NULL,
  protein_g  DECIMAL(6,1)      NOT NULL,
  carbs_g    DECIMAL(6,1)      NOT NULL,
  fat_g      DECIMAL(6,1)      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_coach_plan_meal_items_meal (meal_id, position),
  KEY idx_coach_plan_meal_items_user (user_id),
  CONSTRAINT fk_coach_plan_meal_items_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_coach_plan_meal_items_quantity CHECK (quantity > 0 AND quantity <= 10000),
  CONSTRAINT chk_coach_plan_meal_items_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_coach_plan_meal_items_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;

-- Swap Meal: the options the coach offers for one meal (personal to the member and the day) and a
-- snapshot of the meal each replacement pushed out, so Undo can put it back. "Replace" only ever
-- points at a row here, so nothing the app sends reaches the plan unchecked. Links are not foreign
-- keys (see the cascade note); every query filters on user_id too.
CREATE TABLE coach_meal_options (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id      VARCHAR(64)       NOT NULL,
  plan_id      CHAR(36)          NOT NULL,
  meal_id      CHAR(36)          NOT NULL,
  slot         ENUM('breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner') NOT NULL,
  kind         ENUM('suggestion', 'previous') NOT NULL DEFAULT 'suggestion',  -- an option offered, or the meal a replacement pushed out
  name         VARCHAR(120)      NOT NULL,
  description  VARCHAR(200)      NULL,      -- one line on why it fits (suggestions only)
  note         VARCHAR(300)      NULL,      -- the coach's tip
  items        JSON              NOT NULL,  -- the foods with portions and numbers, cleaned
  kcal         DECIMAL(6,1)      NOT NULL,
  protein_g    DECIMAL(6,1)      NOT NULL,
  carbs_g      DECIMAL(6,1)      NOT NULL,
  fat_g        DECIMAL(6,1)      NOT NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at      TIMESTAMP         NULL,      -- when it went into the plan
  PRIMARY KEY (id),
  KEY idx_coach_meal_options_meal (user_id, meal_id, created_at),
  KEY idx_coach_meal_options_slot (user_id, slot, created_at),
  CONSTRAINT fk_coach_meal_options_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_coach_meal_options_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_coach_meal_options_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;

-- The coach chat: one row per conversation (a new one starts when the member changes coach) and
-- its messages, each kept 7 days from when it was written (coach/chatHistory.js deletes older
-- ones). A send that failed is never saved; client_id is the app's id for one send, so a retry is
-- answered once. The chat link is not a foreign key (see the cascade note); queries filter on user_id.
CREATE TABLE coach_chats (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id      VARCHAR(64)       NOT NULL,
  coach        ENUM('arjun', 'priya', 'rohan', 'meera', 'aditya') NOT NULL,
  created_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_coach_chats_user (user_id, created_at),
  KEY idx_coach_chats_created (created_at),
  CONSTRAINT fk_coach_chats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE coach_chat_messages (
  id           BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  user_id      VARCHAR(64)       NOT NULL,
  chat_id      CHAR(36)          NOT NULL,
  role         ENUM('member', 'coach') NOT NULL,
  text         VARCHAR(1500)     NOT NULL,
  proposals    JSON              NULL,      -- the plan changes a coach reply recommended
  client_id    CHAR(36)          NOT NULL,  -- the app's id for the send (the message and its reply share it)
  created_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_coach_chat_messages_send (user_id, client_id, role),
  KEY idx_coach_chat_messages_chat (user_id, chat_id, id),
  KEY idx_coach_chat_messages_created (created_at),
  CONSTRAINT fk_coach_chat_messages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The coach's weekly review on the Insights tab (coach/insights.js): one per member per week
-- (Monday), written once by the AI from that week's numbers and served from here after. facts_hash
-- is the numbers it was written from (a different hash means the week has moved on since);
-- made_on is the member's day it was written, so a refresh is allowed once a day.
CREATE TABLE coach_insights (
  user_id     VARCHAR(64)   NOT NULL,
  week_start  DATE          NOT NULL,
  summary     VARCHAR(400)  NOT NULL,
  tips        JSON          NOT NULL,                  -- [{ area, text }]
  facts_hash  CHAR(32)      NOT NULL,
  made_on     DATE          NOT NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, week_start),
  CONSTRAINT fk_coach_insights_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Phone sign-in: codes sent by SMS. No foreign key: a code can be for a number that has no account yet.
-- The server writes the id itself (the HMAC covers it) and keeps every row; old rows only
-- count towards the send limits.
CREATE TABLE otp_challenges (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  phone        CHAR(10)          NOT NULL,                     -- 10 digits, +91 implied
  code_hash    CHAR(64)          NOT NULL,                     -- HMAC-SHA256 of "<id>:<code>", hex
  status       ENUM('pending', 'sent', 'failed', 'consumed', 'superseded', 'locked') NOT NULL DEFAULT 'pending',
  attempts     TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  expires_at   DATETIME          NOT NULL,
  consumed_at  DATETIME          NULL,
  created_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),  -- milliseconds: "the latest code" is unambiguous
  PRIMARY KEY (id),
  KEY idx_otp_phone_created (phone, created_at),
  KEY idx_otp_created (created_at),                            -- the daily SMS cap
  CONSTRAINT chk_otp_phone CHECK (phone REGEXP '^[6-9][0-9]{9}$'),
  CONSTRAINT chk_otp_code_hash CHECK (code_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_otp_attempts CHECK (attempts <= 10)
) ENGINE = InnoDB;

-- Phone sign-in: signed-in devices. Only user_id cascades (one level, from users: see the cascade note).
CREATE TABLE auth_sessions (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id       VARCHAR(64)  NOT NULL,
  token_hash    CHAR(64)     NOT NULL,                         -- SHA-256 of the bearer token, hex
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME     NULL,                             -- refreshed at most once an hour
  expires_at    DATETIME     NOT NULL,                         -- absolute: 30 days after sign-in
  revoked_at    DATETIME     NULL,                             -- logout, logout everywhere
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_token (token_hash),
  KEY idx_auth_sessions_user (user_id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_auth_sessions_token CHECK (token_hash REGEXP '^[0-9a-f]{64}$')
) ENGINE = InnoDB;

-- ---- AI usage and cost management (Super Admin › Profile › AI Usage, 2026-10-30) ----

-- One row per AI call the server makes (OpenAI or the Forma scan server), written by the server
-- itself, never from a request. No prompt, photo or reply is stored: only who it was for, which
-- feature and model, the tokens, the cost in rupees at the time (the model's dollar price at the
-- exchange rate then in ai_budget), and whether it worked. user_id is set to
-- NULL when the account is deleted (one level below users, see the cascade note in schema.sql).
-- gym_id and the gym_assistant feature only describe calls made before gyms were removed
-- (2026-11-01); nothing writes them now.
CREATE TABLE ai_usage (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id        VARCHAR(64)      NULL,
  gym_id         CHAR(36)         NULL,
  feature        ENUM('gym_assistant', 'coach_plan', 'coach_workout', 'coach_meal', 'coach_chat', 'food_scan', 'body_scan', 'body_report', 'exercise_library', 'workout_place', 'fitness_program', 'coach_insights', 'coach_voice') NOT NULL,
  provider       ENUM('openai', 'forma') NOT NULL,
  model          VARCHAR(64)      NOT NULL,
  input_tokens   INT UNSIGNED     NOT NULL DEFAULT 0,
  cached_input_tokens INT UNSIGNED NOT NULL DEFAULT 0,  -- the part of input_tokens OpenAI served from its prompt cache (billed cheaper)
  output_tokens  INT UNSIGNED     NOT NULL DEFAULT 0,
  total_tokens   INT UNSIGNED     AS (input_tokens + output_tokens) STORED,
  cost_inr       DECIMAL(12, 4)   NOT NULL DEFAULT 0,
  status         ENUM('ok', 'failed', 'refused') NOT NULL,
  from_cache     BOOLEAN          NOT NULL DEFAULT FALSE,  -- answered from the server's own cache: no model call, no tokens, ₹0
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
CREATE TABLE ai_model_prices (
  model                   VARCHAR(64)    NOT NULL,
  provider                ENUM('openai', 'forma') NOT NULL,
  input_usd_per_million   DECIMAL(10, 4) NOT NULL DEFAULT 0,
  cached_input_usd_per_million DECIMAL(10, 4) NULL,  -- for input served from OpenAI's prompt cache; NULL: same as input
  output_usd_per_million  DECIMAL(10, 4) NOT NULL DEFAULT 0,
  request_usd             DECIMAL(10, 6) NOT NULL DEFAULT 0,  -- a flat cost per call (self-hosted models)
  updated_at              TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (model)
) ENGINE = InnoDB;

-- Official list prices (developers.openai.com/api/docs/pricing, read 2026-10-31). ai/models.js
-- picks the model per feature; a model used without a row here is recorded at ₹0.
INSERT INTO ai_model_prices (model, provider, input_usd_per_million, cached_input_usd_per_million, output_usd_per_million, request_usd) VALUES
  ('gpt-4o',       'openai', 2.5000, 1.2500, 10.0000, 0),
  ('gpt-4o-mini',  'openai', 0.1500, 0.0750,  0.6000, 0),
  ('gpt-4.1',      'openai', 2.0000, 0.5000,  8.0000, 0),
  ('gpt-4.1-mini', 'openai', 0.4000, 0.1000,  1.6000, 0),
  ('gpt-4.1-nano', 'openai', 0.1000, 0.0250,  0.4000, 0),
  ('gpt-5-mini',   'openai', 0.2500, 0.0250,  2.0000, 0),
  ('gpt-5-nano',   'openai', 0.0500, 0.0050,  0.4000, 0),
  ('gpt-4o-mini-transcribe', 'openai', 3.0000, 3.0000, 5.0000, 0), -- billed by audio token: the audio input price (text tokens in the prompt are a handful)
  ('forma',        'forma',  0,      NULL,    0,      0);

-- The monthly budget in rupees, the dollar exchange rate and which alerts are on: one row (id 1).
-- Reaching the limit only alerts; nothing is switched off.
CREATE TABLE ai_budget (
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

INSERT INTO ai_budget (id) VALUES (1);

-- Alerts that fired: each threshold once a month, a spike once a day
CREATE TABLE ai_budget_alerts (
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

-- ---- App usage events (Super Admin › Profile › App Usage, phase 2, 2026-10-30) ----
-- What members do in the app, sent by the app in small batches to POST /api/analytics/events for
-- the signed-in member only (the app never names one). An event is a name from a fixed list, the
-- module it belongs to, the screen when it is a view, a few flat plain values as metadata (no
-- personal data: analytics/rules.js refuses the keys that would carry it), and when it happened on
-- the device. The app makes the id, so a retried batch never stores an event twice. user_id is set
-- to NULL when the account is deleted (one level below users, see the cascade note above), so
-- counts stay right without keeping anything that names the person.
CREATE TABLE analytics_events (
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
CREATE TABLE analytics_sessions (
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

-- ---------------------------------------------------------------------------
-- Gym admin portal (2026-11-04, migrations 2026-11-19-gym-portal.sql to 2026-11-23-member-details.sql).
-- A justFit admin creates a gym brand (gym_brands, e.g. Forma) and its branches (gyms, one row
-- per branch, e.g. Tumkur), and links gym_admin accounts to branches of one brand (gym_staff;
-- the account switches between them, selected_at remembers the last). Everything
-- else belongs to one gym and is written only by its staff: the gym's own members (people at the
-- gym, not app accounts), payments, enquiries and daily check-ins. Money is in whole rupees;
-- days are India's calendar days (the server works them out). Nothing cascades from a gym: gyms
-- are never deleted. Only users cascade (gym_staff), the rest keep their rows with created_by NULL.
-- ---------------------------------------------------------------------------

CREATE TABLE gym_brands (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,              -- the gym's name, e.g. Forma
  logo_key    VARCHAR(64)  NULL,                  -- the logo's file name in GYM_LOGO_DIR (gym/logos.js, migration 2026-12-08); NULL: no logo
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_gym_brands_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE gyms (                               -- one branch of a gym brand
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id    INT UNSIGNED NOT NULL,
  name        VARCHAR(80)  NOT NULL,              -- the branch's name, e.g. Tumkur
  area        VARCHAR(80)  NOT NULL,
  city        VARCHAR(60)  NOT NULL,
  address     VARCHAR(160) NULL,                   -- Invoice details (migration 2026-12-07): printed on invoices, all optional
  phone       CHAR(10)     NULL,
  gstin       CHAR(15)     NULL,
  next_member_no INT UNSIGNED NOT NULL DEFAULT 1,  -- the branch's next member ID number
  next_invoice_no INT UNSIGNED NOT NULL DEFAULT 1, -- the branch's next invoice number (migration 2026-12-07)
  sms_credits INT UNSIGNED NOT NULL DEFAULT 0,     -- SMS to members it can still send (1 credit = 1 SMS)
  latitude    DECIMAL(9,6) NULL,                   -- QR attendance (2026-11-27): the entrance, picked on the map
  longitude   DECIMAL(9,6) NULL,
  attendance_radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 100,  -- how far from it a scan counts (20-1000 m)
  qr_version  INT UNSIGNED NOT NULL DEFAULT 0,     -- the attendance QR code's version (0: none yet); a new one voids the old
  qr_made_at  TIMESTAMP    NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gyms_brand (brand_id),
  CONSTRAINT fk_gyms_brand FOREIGN KEY (brand_id) REFERENCES gym_brands (id),
  CONSTRAINT fk_gyms_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gyms_place CHECK ((latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))),
  CONSTRAINT chk_gyms_radius CHECK (attendance_radius_m BETWEEN 20 AND 1000)
) ENGINE = InnoDB;

-- A branch's team. owner: the gym admin, linked by the justFit Super Admin; staff and trainer:
-- added by the gym admin (Staff / Admin Login, 2026-11-05). An account works at branches of one
-- brand, and is either portal staff (owner, staff: role gym_admin) or a trainer (role trainer).
CREATE TABLE gym_staff (
  user_id      VARCHAR(64)  NOT NULL,           -- on branches of one brand
  gym_id       INT UNSIGNED NOT NULL,
  kind         ENUM('owner', 'staff', 'trainer') NOT NULL DEFAULT 'owner',
  permissions  JSON         NULL,               -- a Staff login's portal areas (gym/staffRules.js AREAS); NULL = every area
  added_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  selected_at  TIMESTAMP(3) NULL,               -- when the account last switched to this branch
  PRIMARY KEY (user_id, gym_id),
  KEY idx_gym_staff_gym (gym_id),
  CONSTRAINT fk_gym_staff_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_staff_gym FOREIGN KEY (gym_id) REFERENCES gyms (id)
) ENGINE = InnoDB;

-- Numbers a gym admin added that haven't signed in to justFit yet: they join the branch's team
-- (and the row goes) when that number first proves itself with a sign-in code
CREATE TABLE gym_staff_invites (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,
  phone       CHAR(10)     NOT NULL,                -- 10 digits, +91 implied
  kind        ENUM('staff', 'trainer') NOT NULL,
  invited_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_staff_invites (gym_id, phone),
  KEY idx_gym_staff_invites_phone (phone),
  CONSTRAINT chk_gym_staff_invites_phone CHECK (phone REGEXP '^[0-9]{10}$'),
  CONSTRAINT fk_gym_staff_invites_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_staff_invites_by FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE gym_members (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id       INT UNSIGNED NOT NULL,
  member_code  VARCHAR(16)  NOT NULL,            -- FOR-TUM-0001: gym, branch, number (server-made)
  full_name    VARCHAR(80)  NOT NULL,
  phone        CHAR(10)     NULL,                -- 10 digits, +91 implied
  dob          DATE         NULL,                -- optional, for birthdays
  gender       ENUM('male', 'female', 'other') NULL,
  email        VARCHAR(120) NULL,                -- optional details from Add New Member
  height_cm    SMALLINT UNSIGNED NULL,
  weight_kg    DECIMAL(5,1) NULL,
  address      VARCHAR(200) NULL,
  notes        VARCHAR(300) NULL,
  photo_key    VARCHAR(64)  NULL,                -- the member's photo file (gym/photos.js); NULL: initials
  plan_months  TINYINT UNSIGNED NULL,            -- the latest plan bought: its months,
  plan_days    SMALLINT UNSIGNED NULL,           -- or its days (exactly one is set)
  plan_name    VARCHAR(80)  NULL,                -- the catalogue plan's name when bought (migration 2026-12-12); NULL: a custom plan
  joined_on    DATE         NOT NULL,
  expires_on   DATE         NOT NULL,            -- the last day the membership covers
  due_amount   INT UNSIGNED NOT NULL DEFAULT 0,  -- rupees still owed
  due_by       DATE         NULL,                -- the date it should be paid by (NULL when nothing is owed)
  pt_label     VARCHAR(60)  NULL,                -- the latest PT package ("12 sessions") and its period
  pt_from      DATE         NULL,
  pt_until     DATE         NULL,
  pt_trainer_id VARCHAR(64) NULL,                -- the trainer the PT is with (a gym_staff trainer)
  created_by   VARCHAR(64)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_members_phone (gym_id, phone),
  UNIQUE KEY uq_gym_members_code (gym_id, member_code),
  KEY idx_gym_members_expiry (gym_id, expires_on),
  KEY idx_gym_members_due_by (gym_id, due_by),
  KEY idx_gym_members_name (gym_id, full_name),
  CONSTRAINT fk_gym_members_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_members_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_members_pt_trainer FOREIGN KEY (pt_trainer_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_members_phone CHECK (phone IS NULL OR phone REGEXP '^[6-9][0-9]{9}$'),
  CONSTRAINT chk_gym_members_plan CHECK (plan_months BETWEEN 1 AND 24),
  CONSTRAINT chk_gym_members_plan_days CHECK (plan_days BETWEEN 1 AND 365),
  CONSTRAINT chk_gym_members_plan_one CHECK ((plan_months IS NULL) <> (plan_days IS NULL)),
  CONSTRAINT chk_gym_members_due CHECK (due_amount <= 1000000),
  CONSTRAINT chk_gym_members_height CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 250),
  CONSTRAINT chk_gym_members_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 10 AND 300)
) ENGINE = InnoDB;

CREATE TABLE gym_payments (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,
  member_id   INT UNSIGNED NULL,                 -- NULL for a product or service sold at the counter
  kind        ENUM('admission', 'renewal', 'due', 'sale', 'pt', 'service') NOT NULL,  -- sale: a product; pt: personal training
  title       VARCHAR(80)  NOT NULL,             -- the member's name, or the item sold
  detail      VARCHAR(80)  NOT NULL,             -- "3 Months", "Due payment", "Supplement", "PT · 12 sessions"
  method      ENUM('online', 'cash') NOT NULL,
  amount      INT UNSIGNED NOT NULL,             -- rupees
  paid_on     DATE         NOT NULL,
  due_by      DATE         NULL,                 -- due payments: the date the due was to be paid by (migration 2026-12-02); NULL before it
  receipt_key VARCHAR(64)  NULL,                 -- the bill's file name in PAYMENT_RECEIPT_DIR (gym/paymentReceipts.js, migration 2026-12-06); NULL: no bill
  invoice_no  INT UNSIGNED NULL,                 -- the branch's running invoice number (migration 2026-12-07); NULL: numbered when its invoice is first opened
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_payments_invoice (gym_id, invoice_no),
  KEY idx_gym_payments_day (gym_id, paid_on),
  KEY idx_gym_payments_member (member_id),
  CONSTRAINT fk_gym_payments_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_payments_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_payments_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_payments_amount CHECK (amount BETWEEN 1 AND 1000000)
) ENGINE = InnoDB;

CREATE TABLE gym_enquiries (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id       INT UNSIGNED NOT NULL,
  full_name    VARCHAR(80)  NOT NULL,
  phone        CHAR(10)     NULL,
  note         VARCHAR(200) NULL,
  -- Follow-up (migration 2026-11-28-gym-enquiry-followup.sql): lost shows as "Not interested";
  -- member_id is the member they became (Convert to member)
  status       ENUM('new', 'follow_up', 'joined', 'lost') NOT NULL DEFAULT 'new',
  follow_up_on DATE         NULL,
  interest     ENUM('membership', 'pt', 'trial', 'other') NULL,
  source       ENUM('walk_in', 'call', 'whatsapp', 'instagram', 'referral', 'other') NULL,
  referred_by_phone CHAR(10) NULL,                -- a referral: who referred them (migration 2026-12-09-enquiry-referrer.sql)
  member_id    INT UNSIGNED NULL,
  enquired_on  DATE         NOT NULL,
  created_by   VARCHAR(64)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_enquiries_day (gym_id, enquired_on),
  KEY idx_gym_enquiries_followup (gym_id, status, follow_up_on),
  CONSTRAINT fk_gym_enquiries_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_enquiries_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_enquiries_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_enquiries_phone CHECK (phone IS NULL OR phone REGEXP '^[6-9][0-9]{9}$'),
  CONSTRAINT chk_gym_enquiries_referrer CHECK (referred_by_phone IS NULL OR referred_by_phone REGEXP '^[6-9][0-9]{9}$')
) ENGINE = InnoDB;

-- Enquiry contacts (migration 2026-11-30-gym-enquiry-contacts.sql): one row per contact attempt
-- with an enquiry (a call, a WhatsApp message or a visit) and how it went, for the enquiry
-- conversion score in Manage › Enquiry
CREATE TABLE gym_enquiry_contacts (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id        INT UNSIGNED NOT NULL,
  enquiry_id    INT UNSIGNED NOT NULL,
  kind          ENUM('call', 'whatsapp', 'visit') NOT NULL,
  outcome       ENUM('reached', 'no_answer', 'visited') NOT NULL,
  contacted_on  DATE         NOT NULL,             -- India's date
  created_by    VARCHAR(64)  NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_enquiry_contacts_enquiry (enquiry_id, contacted_on),
  CONSTRAINT fk_gym_enquiry_contacts_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_enquiry_contacts_enquiry FOREIGN KEY (enquiry_id) REFERENCES gym_enquiries (id),
  CONSTRAINT fk_gym_enquiry_contacts_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One visit to a branch (QR attendance, migration 2026-11-27-gym-qr-attendance.sql): checked in by a
-- QR scan in the member's app (with the GPS reading and its distance from the gym) or by staff;
-- 'inside' until checked out ('completed', with the minutes worked out by the server) or left open
-- for 12 hours ('no_checkout'). open_member_id lets a member have only one open visit.
CREATE TABLE gym_attendance (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id         INT UNSIGNED NOT NULL,
  member_id      INT UNSIGNED NOT NULL,
  on_date        DATE         NOT NULL,             -- India's date at check-in
  checked_in_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_out_at TIMESTAMP    NULL,
  status         ENUM('inside', 'completed', 'no_checkout') NOT NULL DEFAULT 'inside',
  duration_min   SMALLINT UNSIGNED NULL,            -- set at check-out, by the server
  in_source      ENUM('staff', 'qr') NOT NULL DEFAULT 'staff',
  out_source     ENUM('staff', 'qr') NULL,
  check_in_lat   DECIMAL(9,6) NULL,                 -- the phone's reading at a QR check-in / check-out
  check_in_lng   DECIMAL(9,6) NULL,
  check_in_accuracy_m  SMALLINT UNSIGNED NULL,
  check_in_distance_m  SMALLINT UNSIGNED NULL,      -- from the gym, as the server measured it
  check_out_lat  DECIMAL(9,6) NULL,
  check_out_lng  DECIMAL(9,6) NULL,
  check_out_accuracy_m SMALLINT UNSIGNED NULL,
  check_out_distance_m SMALLINT UNSIGNED NULL,
  open_member_id INT UNSIGNED AS (IF(status = 'inside', member_id, NULL)) STORED,
  created_by     VARCHAR(64)  NULL,                 -- the staff account that checked them in (NULL: the member's scan)
  checked_out_by VARCHAR(64)  NULL,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_attendance_open (open_member_id),  -- one open visit per member
  KEY idx_gym_attendance_member (member_id, on_date),
  KEY idx_gym_attendance_day (gym_id, on_date),
  KEY idx_gym_attendance_status (gym_id, status),
  CONSTRAINT fk_gym_attendance_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_attendance_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_attendance_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_attendance_checked_out_by FOREIGN KEY (checked_out_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- A branch's price list (Plans / Catalogue, 2026-11-04, migration 2026-11-21-gym-catalog.sql):
-- membership plans, PT packages, services and products. The forms fill the fee from it; a payment keeps its
-- own amount and words, so changing or deleting an item never changes past payments.
CREATE TABLE gym_catalog_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,                -- the branch whose price list it is
  kind        ENUM('plan', 'pt', 'service', 'product') NOT NULL,
  name        VARCHAR(80)  NOT NULL,                -- "3 Months", "12 sessions", "Steam bath", "Whey Protein 1kg"
  duration       SMALLINT UNSIGNED NULL,            -- how long: plans always, PT packages optionally
  duration_unit  ENUM('months', 'days') NULL,       -- 1-24 months or 1-365 days
  price       INT UNSIGNED NOT NULL,                -- rupees
  stock       INT UNSIGNED NULL,                    -- products only: how many are left (NULL = not counted)
  image_key   VARCHAR(64)  NULL,                    -- an optional picture or brochure photo (a file name in CATALOG_IMAGE_DIR; migration 2026-12-04)
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_catalog_kind (gym_id, kind),
  CONSTRAINT fk_gym_catalog_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_catalog_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_catalog_price CHECK (price BETWEEN 1 AND 1000000),
  CONSTRAINT chk_gym_catalog_stock CHECK (stock IS NULL OR (kind = 'product' AND stock <= 100000)),
  CONSTRAINT chk_gym_catalog_lengths CHECK (
    (kind IN ('plan', 'pt') AND ((duration_unit = 'months' AND duration BETWEEN 1 AND 24) OR (duration_unit = 'days' AND duration BETWEEN 1 AND 365)))
    OR (kind <> 'plan' AND duration IS NULL AND duration_unit IS NULL))
) ENGINE = InnoDB;

-- Send Bulk SMS (gym/sms.js): which auto reminders a branch has switched on (no row = off)
CREATE TABLE gym_sms_settings (
  gym_id      INT UNSIGNED NOT NULL,
  kind        ENUM('expiry', 'expired', 'due', 'birthday') NOT NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 0,
  updated_by  VARCHAR(64)  NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id, kind),
  CONSTRAINT fk_gym_sms_settings_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_sms_settings_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Every SMS sent to a member (Message Logs): what it said, how it went, the credit it cost
-- (0 once refunded after a failure). auto_key makes each auto reminder go once per member
-- ("expiry:2026-11-30", "due:2026-11-02", "birthday:2026"); manual sends have none.
CREATE TABLE gym_sms_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,
  member_id   INT UNSIGNED NOT NULL,
  kind        ENUM('expiry', 'expired', 'due', 'birthday') NOT NULL,
  source      ENUM('auto', 'manual') NOT NULL,
  status      ENUM('sending', 'sent', 'failed') NOT NULL,
  body        VARCHAR(320) NOT NULL,
  credits     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  auto_key    VARCHAR(40)  NULL,
  error       VARCHAR(40)  NULL,                    -- the provider's status code only
  sent_by     VARCHAR(64)  NULL,                    -- the gym admin (NULL for auto reminders)
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_sms_auto (member_id, auto_key),
  KEY idx_gym_sms_log_gym (gym_id, id),
  CONSTRAINT fk_gym_sms_log_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_sms_log_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_sms_log_by FOREIGN KEY (sent_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Pause Membership (migration 2026-12-05-membership-pauses.sql): a member's pause request from
-- the app (pending until the gym's staff approve or reject it) or a pause the staff recorded
-- themselves (approved at once). An approved pause adds its days to the member's expires_on
-- (kept in extended_days) and blocks QR check-ins while it runs.
CREATE TABLE gym_membership_pauses (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id         INT UNSIGNED NOT NULL,
  member_id      INT UNSIGNED NOT NULL,
  requested_by   ENUM('member', 'staff') NOT NULL,
  status         ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  pause_from     DATE         NOT NULL,
  pause_until    DATE         NOT NULL,              -- the last paused day
  days           SMALLINT UNSIGNED NOT NULL,         -- pause_until - pause_from + 1, by the server
  reason         VARCHAR(200) NOT NULL,
  requester_id   VARCHAR(64)  NULL,                  -- the account that asked (the member's, or the staff login's)
  decided_by     VARCHAR(64)  NULL,                  -- the staff login that approved or rejected
  decided_at     TIMESTAMP    NULL,
  decision_note  VARCHAR(200) NULL,
  extended_days  SMALLINT UNSIGNED NULL,             -- days added to expires_on when approved
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_pauses_gym (gym_id, status, id),
  KEY idx_gym_pauses_member (member_id, status, id),
  CONSTRAINT fk_gym_pauses_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_pauses_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_pauses_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_pauses_decided_by FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_pauses_dates CHECK (pause_until >= pause_from),
  CONSTRAINT chk_gym_pauses_days CHECK (days BETWEEN 1 AND 365)
) ENGINE = InnoDB;

-- Gym expenses (migration 2026-12-10-gym-expenses.sql): each branch's spending (Manage › Expense),
-- with who was paid, cash or online, a note and an optional bill photo (a file name in
-- EXPENSE_BILL_DIR, gym/expenseBills.js). Wallet subtracts the month's spending for the net.
CREATE TABLE gym_expenses (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,                -- the branch that spent it
  category    ENUM('rent', 'salary', 'electricity', 'water', 'equipment', 'maintenance', 'cleaning', 'marketing', 'stock', 'other') NOT NULL,
  title       VARCHAR(80)  NULL,                    -- what it was; needed for 'other'
  paid_to     VARCHAR(80)  NULL,                    -- the landlord, a trainer, a vendor
  method      ENUM('online', 'cash') NOT NULL,
  amount      INT UNSIGNED NOT NULL,                -- rupees
  spent_on    DATE         NOT NULL,
  note        VARCHAR(200) NULL,
  bill_key    VARCHAR(64)  NULL,                    -- the bill photo's file name; NULL: none
  created_by  VARCHAR(64)  NULL,
  updated_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_expenses_day (gym_id, spent_on, id),
  CONSTRAINT fk_gym_expenses_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_expenses_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_expenses_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_expenses_amount CHECK (amount BETWEEN 1 AND 1000000)
) ENGINE = InnoDB;

-- Reminder Templates (migration 2026-12-11-reminder-templates.sql): a branch's own wording for
-- Send Reminder and the enquiry WhatsApp button. No row: justFit's default text. The app fills in
-- the {placeholders}; justFit's own SMS keep the DLT texts (gym/smsRules.js).
CREATE TABLE gym_reminder_templates (
  gym_id      INT UNSIGNED NOT NULL,                -- the branch
  kind        ENUM('due', 'expiry', 'expired', 'enquiry') NOT NULL,
  body        VARCHAR(300) NOT NULL,                -- the text with its {placeholders}
  updated_by  VARCHAR(64)  NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id, kind),
  CONSTRAINT fk_gym_reminder_templates_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_reminder_templates_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
