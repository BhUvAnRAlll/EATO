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
  (1, 'Today''s Macros', 'Edit Goal', 'Popular Meals', 'View all', 'Today', 'View all', TRUE,
   '[]',
   '["grilled-chicken-bowl","paneer-tikka-bowl","salmon-bowl"]');

INSERT INTO promotions (title, eyebrow, headline, description, image_url, image_alt, cta_label, cta_destination, status, display_order) VALUES
  ('Chef-prepared meals', 'CHEF-PREPARED', 'Healthy meals for a stronger you', 'Nutritious, chef-prepared meals delivered to your doorstep.', 'asset:hero-bowl', 'Grilled chicken bowl with vegetables', 'Order Now', 'explore', 'published', 1),
  ('Your fitness, your food', 'YOUR FITNESS, YOUR FOOD', 'Eat better. Reach your goals.', 'Delicious meals designed around your nutrition targets.', 'asset:hero-nutrition', 'Fresh ingredients on a board', 'Explore Meals', 'explore', 'published', 2),
  ('Fuel your day', 'FUEL YOUR DAY', 'Better nutrition starts here', 'Find meals that fit your lifestyle and daily macros.', 'asset:hero-delivery', 'Packed EATO meal boxes', 'View Menu', 'explore', 'published', 3);

-- ---------------------------------------------------------------------------
-- Community: feed, stories, direct messages
-- ---------------------------------------------------------------------------

-- An image a member uploaded (post, story, gym logo or cover). The bytes live on the server's
-- disk under uploads/<id>.<ext> and are served only to signed-in members; the row keeps
-- the owner, type and size so files can be checked and cleaned up.
CREATE TABLE community_media (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  media_type  ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL,
  byte_size   INT UNSIGNED NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_media_user (user_id),
  CONSTRAINT fk_media_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Gym communities. A platform admin creates a gym and names its owner (gym_members role
-- 'owner'). visibility: public (anyone can read the feed and join or ask to), private (listed,
-- but content is for members and joining needs approval) or hidden (only members and people
-- with an invite code can find it). The community settings decide who may post, comment and
-- create events. A gym is never hard-deleted (posts reference it with RESTRICT), so nothing
-- here depends on a deep cascade. hours, facilities, membership_tiers and guidelines are
-- small JSON lists checked by the server (gyms/validate.js). plan is a display-only card:
-- no payment exists.
CREATE TABLE gyms (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  name                   VARCHAR(80)   NOT NULL,
  tagline                VARCHAR(120)  NULL,
  description            VARCHAR(1000) NULL,
  location               VARCHAR(80)   NULL,            -- the area, e.g. "Indiranagar, Bengaluru"
  address                VARCHAR(200)  NULL,
  logo_media_id          CHAR(36)      NULL,
  cover_media_id         CHAR(36)      NULL,
  hours                  JSON          NULL,            -- [{ label, value }]
  facilities             JSON          NULL,            -- ["Free weights", ...]
  membership_tiers       JSON          NULL,            -- [{ name, price, perks }]
  guidelines             JSON          NULL,            -- ["Re-rack your weights", ...]
  contact_phone          VARCHAR(20)   NULL,
  contact_email          VARCHAR(120)  NULL,
  contact_website        VARCHAR(200)  NULL,
  invite_code            CHAR(8)       NOT NULL,        -- joins as a member (an invitation, so no approval)
  visibility             ENUM('public', 'private', 'hidden') NOT NULL DEFAULT 'public',
  who_can_post           ENUM('everyone', 'trainers', 'admins') NOT NULL DEFAULT 'everyone',
  who_can_comment        ENUM('members', 'trainers', 'off') NOT NULL DEFAULT 'members',
  who_can_create_events  ENUM('admins', 'trainers', 'members') NOT NULL DEFAULT 'trainers',
  member_approval        BOOLEAN       NOT NULL DEFAULT FALSE,
  post_moderation        BOOLEAN       NOT NULL DEFAULT FALSE,
  plan                   ENUM('starter', 'pro', 'elite') NOT NULL DEFAULT 'starter',
  member_count           INT UNSIGNED  NOT NULL DEFAULT 0,  -- active members, kept in step by the server
  created_by             VARCHAR(64)   NULL,            -- the platform admin who created it
  created_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gyms_name (name),
  UNIQUE KEY uq_gyms_invite_code (invite_code),
  KEY idx_gyms_visibility (visibility, name),
  CONSTRAINT fk_gyms_logo FOREIGN KEY (logo_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_gyms_cover FOREIGN KEY (cover_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_gyms_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Feed posts. gym_id NULL = the main feed; otherwise the post belongs to that gym. review_status 'pending' = held for gym staff (post moderation is on).
-- Counts are kept in step by the server inside the same transaction as the like/comment.
CREATE TABLE community_posts (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  user_id        VARCHAR(64)   NOT NULL,
  gym_id         CHAR(36)      NULL,
  review_status  ENUM('published', 'pending') NOT NULL DEFAULT 'published',
  category       ENUM('general', 'meal', 'workout', 'progress', 'achievement', 'photo', 'question', 'poll') NOT NULL DEFAULT 'general',  -- the post type
  audience       ENUM('public', 'followers', 'only_me') NOT NULL DEFAULT 'public',  -- who may see it (gym posts: the gym)
  body           VARCHAR(1000) NOT NULL,
  headline       VARCHAR(120)  NULL,                -- progress title, meal name or achievement title
  detail         VARCHAR(300)  NULL,                -- progress milestone or achievement description
  detail_date    DATE          NULL,                -- progress date
  meal_kcal      SMALLINT UNSIGNED NULL,
  meal_protein_g SMALLINT UNSIGNED NULL,
  location       VARCHAR(120)  NULL,
  media_id       CHAR(36)      NULL,                -- the first image (cover); the full ordered list is community_post_media
  client_key     CHAR(36)      NULL,                -- set by the app per draft, so a repeated Publish can't save twice
  like_count     INT UNSIGNED  NOT NULL DEFAULT 0,
  comment_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP     NULL,                -- soft delete, so reports keep their context
  PRIMARY KEY (id),
  KEY idx_posts_feed (deleted_at, created_at, id),  -- newest first, cursor on (created_at, id)
  KEY idx_posts_gym (gym_id, deleted_at, created_at),
  KEY idx_posts_user (user_id, created_at),
  UNIQUE KEY uq_posts_client_key (user_id, client_key),
  CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_posts_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_posts_media FOREIGN KEY (media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT chk_posts_meal_kcal CHECK (meal_kcal <= 5000),
  CONSTRAINT chk_posts_meal_protein CHECK (meal_protein_g <= 500)
) ENGINE = InnoDB;

-- The images on a post, in the order they are shown (up to a few per post). The post's
-- media_id stays the first of these, so anything that shows one cover image keeps working.
CREATE TABLE community_post_media (
  post_id   CHAR(36)         NOT NULL,
  media_id  CHAR(36)         NOT NULL,
  position  TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (post_id, media_id),
  UNIQUE KEY uq_post_media_position (post_id, position),
  KEY idx_post_media_media (media_id),
  CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_media_media FOREIGN KEY (media_id) REFERENCES community_media (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE community_post_likes (
  post_id     CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),                   -- a member likes a post once
  CONSTRAINT fk_likes_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Friends tagged on a post ("with Sarah Chen"): accepted friends only, checked by the server.
-- Cascades stay one level below posts (a three-level chain orphans rows on MySQL 9.7).
CREATE TABLE community_post_tags (
  post_id     CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  PRIMARY KEY (post_id, user_id),
  KEY idx_post_tags_user (user_id),
  CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_tags_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- A poll's choices, 2 to 6, in order; fixed once the poll is posted
CREATE TABLE community_poll_options (
  id        CHAR(36)         NOT NULL DEFAULT (UUID()),
  post_id   CHAR(36)         NOT NULL,
  position  TINYINT UNSIGNED NOT NULL,
  label     VARCHAR(80)      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_poll_options_position (post_id, position),
  CONSTRAINT fk_poll_options_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One vote per member per poll (changing it replaces the row). option_id is checked by the
-- server against the poll's options, not a foreign key (that would be a three-level chain).
CREATE TABLE community_poll_votes (
  post_id     CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  option_id   CHAR(36)    NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  KEY idx_poll_votes_option (option_id),
  CONSTRAINT fk_poll_votes_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_poll_votes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE community_comments (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  post_id     CHAR(36)     NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  body        VARCHAR(500) NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY idx_comments_post (post_id, deleted_at, created_at, id),   -- oldest first, cursor on (created_at, id)
  CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Stories: an image with an optional caption, gone after expires_at (24 h by default).
-- audience: everyone eligible, accepted followers, or the owner's close friends. A deleted
-- story is kept (deleted_at) so a report keeps its context; old rows are purged later.
CREATE TABLE community_stories (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  media_id    CHAR(36)     NOT NULL,
  caption     VARCHAR(200) NULL,
  audience    ENUM('public', 'followers', 'close_friends') NOT NULL DEFAULT 'public',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP    NOT NULL,
  deleted_at  TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY idx_stories_active (expires_at, user_id, created_at),
  CONSTRAINT fk_stories_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_stories_media FOREIGN KEY (media_id) REFERENCES community_media (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE community_story_views (
  story_id   CHAR(36)    NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  viewed_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, user_id),                  -- a view is recorded once
  CONSTRAINT fk_story_views_story FOREIGN KEY (story_id) REFERENCES community_stories (id) ON DELETE CASCADE,
  CONSTRAINT fk_story_views_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- A member reporting a post or a comment, for an admin to review
CREATE TABLE community_reports (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  reporter_id  VARCHAR(64)  NOT NULL,
  post_id      CHAR(36)     NULL,
  comment_id   CHAR(36)     NULL,
  story_id     CHAR(36)     NULL,
  reason       VARCHAR(300) NOT NULL,
  status       ENUM('open', 'reviewed', 'dismissed') NOT NULL DEFAULT 'open',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reports_status (status, created_at),
  CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_comment FOREIGN KEY (comment_id) REFERENCES community_comments (id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_story FOREIGN KEY (story_id) REFERENCES community_stories (id) ON DELETE CASCADE,
  CONSTRAINT chk_reports_target CHECK ((post_id IS NOT NULL) + (comment_id IS NOT NULL) + (story_id IS NOT NULL) = 1)
) ENGINE = InnoDB;

-- Direct messages between two members. A member only ever sees conversations they are in.
CREATE TABLE conversations (
  id               CHAR(36)   NOT NULL DEFAULT (UUID()),
  created_at       TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at  TIMESTAMP(6) NULL,                 -- sub-second, so unread counts are exact
  PRIMARY KEY (id),
  KEY idx_conversations_recent (last_message_at)
) ENGINE = InnoDB;

CREATE TABLE conversation_members (
  conversation_id  CHAR(36)    NOT NULL,
  user_id          VARCHAR(64) NOT NULL,
  last_read_at     TIMESTAMP(6) NULL,               -- messages after this are unread (sub-second)
  PRIMARY KEY (conversation_id, user_id),
  KEY idx_conversation_members_user (user_id),
  CONSTRAINT fk_conv_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE messages (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  conversation_id  CHAR(36)      NOT NULL,
  sender_id        VARCHAR(64)   NOT NULL,
  body             VARCHAR(1000) NOT NULL,
  created_at       TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_messages_conversation (conversation_id, created_at, id),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Community account settings: a private account shows its posts and stories to accepted
-- followers only; a suspended account's content is hidden from everyone but admins.
-- One row per member, created on first use (members without a row are public and active).
CREATE TABLE community_profiles (
  user_id     VARCHAR(64)  NOT NULL,
  is_private  BOOLEAN      NOT NULL DEFAULT FALSE,
  status      ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  bio         VARCHAR(160) NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_cprofiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- follower_id follows following_id. Following a public account is accepted at once; a
-- private account's owner accepts or declines the request.
CREATE TABLE community_follows (
  follower_id   VARCHAR(64) NOT NULL,
  following_id  VARCHAR(64) NOT NULL,
  status        ENUM('pending', 'accepted') NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, following_id),
  KEY idx_follows_following (following_id, status),
  CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_follows_following FOREIGN KEY (following_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_follows_self CHECK (follower_id <> following_id)
) ENGINE = InnoDB;

-- blocker_id can't see blocked_id's content and vice versa
CREATE TABLE community_blocks (
  blocker_id  VARCHAR(64) NOT NULL,
  blocked_id  VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY idx_blocks_blocked (blocked_id),
  CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_blocks_self CHECK (blocker_id <> blocked_id)
) ENGINE = InnoDB;

-- A member's Close Friends: who sees their close-friends stories. Only the owner can read
-- or change the list (a member can't add themselves; checked in the API).
CREATE TABLE community_close_friends (
  owner_id    VARCHAR(64) NOT NULL,
  friend_id   VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_id, friend_id),
  KEY idx_close_friends_friend (friend_id),
  CONSTRAINT fk_close_friends_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_close_friends_friend FOREIGN KEY (friend_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Friendships (Add Friend): one row per pair of members, separate from follows. user_low /
-- user_high are the pair in a fixed order (community/friendRules.js pairOf), so the primary
-- key allows one row per pair whichever side asks first; requester_id sent the current
-- request. Every change is an UPDATE of status, never a DELETE, so the history stays.
-- An accepted friendship unlocks messaging. Same as migrations/2026-10-17-friends.sql.
CREATE TABLE community_friendships (
  user_low      VARCHAR(64) NOT NULL,
  user_high     VARCHAR(64) NOT NULL,
  requester_id  VARCHAR(64) NOT NULL,
  status        ENUM('pending', 'accepted', 'declined', 'cancelled', 'removed') NOT NULL DEFAULT 'pending',
  requested_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at  TIMESTAMP   NULL,
  updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_low, user_high),
  KEY idx_friendships_high (user_high, status),
  KEY idx_friendships_requester (requester_id, status),
  CONSTRAINT fk_friendships_low FOREIGN KEY (user_low) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_high FOREIGN KEY (user_high) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_friendships_order CHECK (user_low < user_high),
  CONSTRAINT chk_friendships_requester CHECK (requester_id = user_low OR requester_id = user_high)
) ENGINE = InnoDB;

-- Who belongs to a gym, with their role and where their membership stands. pending = asked
-- to join and waiting for approval; suspended = removed from posting and reading by staff.
-- One owner per gym (owner_gym is the gym id only for the owner, and it is unique).
CREATE TABLE gym_members (
  gym_id        CHAR(36)    NOT NULL,
  user_id       VARCHAR(64) NOT NULL,
  role          ENUM('owner', 'admin', 'trainer', 'member') NOT NULL DEFAULT 'member',
  status        ENUM('active', 'pending', 'suspended') NOT NULL DEFAULT 'active',
  requested_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  joined_at     TIMESTAMP   NULL,                     -- when the membership became active
  owner_gym     CHAR(36)    AS (IF(role = 'owner', gym_id, NULL)) VIRTUAL,
  PRIMARY KEY (gym_id, user_id),
  UNIQUE KEY uq_gym_members_one_owner (owner_gym),
  KEY idx_gym_members_user (user_id, status),
  KEY idx_gym_members_gym_status (gym_id, status, role),
  CONSTRAINT fk_gym_members_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- An invitation recorded by gym staff. channel link/qr share its code; email/phone only record
-- who it was meant for (nothing is sent). Accepting the code joins with `role` (member or
-- trainer). Revoked and expired codes no longer work; renewing gives a pending one a new date.
CREATE TABLE gym_invitations (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id       CHAR(36)     NOT NULL,
  code         CHAR(10)     NOT NULL,
  channel      ENUM('link', 'qr', 'email', 'phone') NOT NULL,
  contact      VARCHAR(120) NULL,                    -- the email or phone it was meant for
  role         ENUM('member', 'trainer') NOT NULL DEFAULT 'member',
  status       ENUM('pending', 'accepted', 'revoked') NOT NULL DEFAULT 'pending',
  invited_by   VARCHAR(64)  NULL,
  accepted_by  VARCHAR(64)  NULL,
  expires_at   TIMESTAMP    NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_invitations_code (code),
  KEY idx_gym_invitations_gym (gym_id, status, created_at),
  CONSTRAINT fk_gym_invitations_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_invitations_inviter FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_invitations_accepter FOREIGN KEY (accepted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Announcements from gym admins, shown above the gym feed (pinned first)
CREATE TABLE gym_announcements (
  id          CHAR(36)      NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)      NOT NULL,
  author_id   VARCHAR(64)   NULL,
  title       VARCHAR(120)  NOT NULL,
  body        VARCHAR(1000) NOT NULL,
  pinned      BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_announcements_gym (gym_id, pinned, updated_at),
  CONSTRAINT fk_gym_announcements_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_announcements_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Gym events. attendee_count is kept in step with gym_event_rsvps inside the RSVP transaction,
-- which locks the event row so max_attendees can't be overrun by two members at once.
CREATE TABLE gym_events (
  id              CHAR(36)          NOT NULL DEFAULT (UUID()),
  gym_id          CHAR(36)          NOT NULL,
  host_id         VARCHAR(64)       NULL,
  title           VARCHAR(80)       NOT NULL,
  description     VARCHAR(1000)     NOT NULL,
  event_date      DATE              NOT NULL,
  start_time      TIME              NOT NULL,
  end_time        TIME              NOT NULL,
  location        VARCHAR(120)      NOT NULL,
  max_attendees   SMALLINT UNSIGNED NULL,          -- NULL = no limit
  attendee_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_events_gym_date (gym_id, event_date, start_time),
  CONSTRAINT fk_gym_events_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_events_host FOREIGN KEY (host_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_events_times CHECK (end_time > start_time),
  CONSTRAINT chk_gym_events_capacity CHECK (max_attendees IS NULL OR max_attendees >= 1)
) ENGINE = InnoDB;

-- Who is going to an event: one row per member and event
CREATE TABLE gym_event_rsvps (
  event_id    CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  KEY idx_gym_event_rsvps_user (user_id),
  CONSTRAINT fk_gym_event_rsvps_event FOREIGN KEY (event_id) REFERENCES gym_events (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_event_rsvps_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

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
-- library behind them. Plans come from the engine in Eato_client/src/lib/workout
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

-- The exercise library. Built-in rows are kept in step with Eato_client/src/lib/workout/
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
  thumbnail_media_id  CHAR(36)          NULL,
  video_media_id      CHAR(36)          NULL,         -- demo clips: not uploaded yet (video support is deferred)
  built_in            BOOLEAN           NOT NULL DEFAULT FALSE,
  created_by          VARCHAR(64)       NULL,         -- set on admin-authored rows only
  archived_at         TIMESTAMP         NULL,
  created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_library_name (name),
  KEY idx_workout_library_group (muscle_group, name),
  KEY idx_workout_library_pattern (pattern, difficulty),
  CONSTRAINT fk_workout_library_thumbnail FOREIGN KEY (thumbnail_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_workout_library_video FOREIGN KEY (video_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_workout_library_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_workout_library_difficulty CHECK (difficulty BETWEEN 1 AND 3),
  CONSTRAINT chk_workout_library_timed CHECK (timed_sec IS NULL OR timed_sec BETWEEN 1 AND 3600)
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
  source                        ENUM('engine', 'member', 'trainer') NOT NULL DEFAULT 'engine',
  created_by                    VARCHAR(64)       NULL,   -- the trainer, for trainer-written plans
  trainer_note                  VARCHAR(300)      NULL,   -- the trainer's note to the member about the latest change
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
  KEY idx_workout_plans_creator (created_by),
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
  created_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_days_plan_weekday (plan_id, weekday),
  KEY idx_workout_days_user (user_id),
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
-- Trainers: profiles, client connections, diet plans and target recommendations
-- ---------------------------------------------------------------------------
-- A trainer is an account whose Clerk role is "trainer" and who saved a profile here. A member
-- has at most one trainer (trainer_connections); an accepted connection also lives in
-- trainer_clients, which every trainer action is checked against. Every table cascades straight
-- from users (plan_id / meal_id are indexed columns the server checks) because of the
-- three-level cascade defect in the MySQL version in use.

CREATE TABLE trainer_profiles (
  user_id           VARCHAR(64)   NOT NULL,
  title             VARCHAR(80)   NOT NULL,          -- e.g. "Strength coach"
  specialties       JSON          NOT NULL,          -- ["weight_loss", "muscle_gain", "nutrition", "strength", "yoga"]
  years_experience  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bio               VARCHAR(300)  NOT NULL,
  coaching_mode     ENUM('online', 'in_person', 'both') NOT NULL DEFAULT 'online',
  offers_nutrition  BOOLEAN       NOT NULL DEFAULT FALSE,
  accepting_clients BOOLEAN       NOT NULL DEFAULT TRUE,
  availability      VARCHAR(120)  NULL,              -- "Mon–Sat, 6–10am"
  approach          VARCHAR(1000) NULL,              -- shown after acceptance
  qualifications    JSON          NULL,              -- ["ACE CPT", ...], shown after acceptance
  languages         JSON          NULL,              -- ["English", "Kannada"], shown after acceptance
  photo_media_id    CHAR(36)      NULL,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_trainer_profiles_accepting (accepting_clients, title),
  CONSTRAINT fk_trainer_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_profiles_photo FOREIGN KEY (photo_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT chk_trainer_profiles_years CHECK (years_experience <= 60)
) ENGINE = InnoDB;

-- Every connection request, kept as history. open_client is the client id only while the row
-- is requested or connected, and it is unique: a member has one trainer (or one open request).
CREATE TABLE trainer_connections (
  id            CHAR(36)    NOT NULL DEFAULT (UUID()),
  trainer_id    VARCHAR(64) NOT NULL,
  client_id     VARCHAR(64) NOT NULL,
  status        ENUM('requested', 'connected', 'declined', 'cancelled', 'ended') NOT NULL DEFAULT 'requested',
  ended_by      VARCHAR(64) NULL,                    -- who ended or declined it
  requested_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at  TIMESTAMP   NULL,
  ended_at      TIMESTAMP   NULL,
  open_client   VARCHAR(64) AS (IF(status IN ('requested', 'connected'), client_id, NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trainer_connections_open (open_client),
  KEY idx_trainer_connections_trainer (trainer_id, status, requested_at),
  KEY idx_trainer_connections_client (client_id, status),
  CONSTRAINT fk_trainer_connections_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_connections_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_trainer_connections_self CHECK (trainer_id <> client_id)
) ENGINE = InnoDB;

-- What the trainer recommends as the client's daily target. Kept separate from the client's own
-- target (nutrition_targets): it becomes active only when the client applies it, and the target
-- they had at that moment is saved here so they can go back to it. A row newer than the one
-- applied shows as "New".
CREATE TABLE trainer_target_recommendations (
  id            CHAR(36)          NOT NULL DEFAULT (UUID()),
  trainer_id    VARCHAR(64)       NOT NULL,
  client_id     VARCHAR(64)       NOT NULL,
  calories      SMALLINT UNSIGNED NOT NULL,
  protein_g     SMALLINT UNSIGNED NOT NULL,
  carbs_g       SMALLINT UNSIGNED NOT NULL,
  fat_g         SMALLINT UNSIGNED NOT NULL,
  note          VARCHAR(300)      NULL,
  applied_at    TIMESTAMP         NULL,
  prior_target  JSON              NULL,              -- the client's active target when they applied this one
  created_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trainer_recs_client (client_id, created_at),
  CONSTRAINT fk_trainer_recs_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_recs_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_trainer_recs_calories CHECK (calories BETWEEN 800 AND 6000),
  CONSTRAINT chk_trainer_recs_macros CHECK (protein_g <= 600 AND carbs_g <= 900 AND fat_g <= 600)
) ENGINE = InnoDB;

-- A diet plan a trainer wrote for a client: five meals a day with foods and quantities. One
-- active plan per client (active_client is unique); replacing it supersedes the old one.
CREATE TABLE diet_plans (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  trainer_id     VARCHAR(64)  NOT NULL,
  client_id      VARCHAR(64)  NOT NULL,
  name           VARCHAR(80)  NOT NULL,
  goal           ENUM('fat_loss', 'muscle_gain', 'maintenance') NOT NULL,
  start_date     DATE         NOT NULL,
  end_date       DATE         NULL,
  notes          VARCHAR(1000) NULL,
  status         ENUM('active', 'superseded') NOT NULL DEFAULT 'active',
  active_client  VARCHAR(64)  AS (IF(status = 'active', client_id, NULL)) VIRTUAL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_diet_plans_one_active (active_client),
  KEY idx_diet_plans_client (client_id, status),
  KEY idx_diet_plans_trainer (trainer_id),
  CONSTRAINT fk_diet_plans_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_diet_plans_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE diet_plan_meals (
  id         CHAR(36)         NOT NULL DEFAULT (UUID()),
  plan_id    CHAR(36)         NOT NULL,
  client_id  VARCHAR(64)      NOT NULL,
  slot       ENUM('breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner') NOT NULL,
  name       VARCHAR(120)     NOT NULL,
  meal_time  TIME             NOT NULL,
  note       VARCHAR(300)     NULL,
  position   TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_diet_plan_meals_slot (plan_id, slot),
  KEY idx_diet_plan_meals_plan (plan_id, position),
  KEY idx_diet_plan_meals_client (client_id),
  CONSTRAINT fk_diet_plan_meals_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- The foods in a plan meal: the same columns as the diary's items, so logging copies them over
CREATE TABLE diet_plan_meal_items (
  id         CHAR(36)          NOT NULL DEFAULT (UUID()),
  meal_id    CHAR(36)          NOT NULL,
  client_id  VARCHAR(64)       NOT NULL,
  position   TINYINT UNSIGNED  NOT NULL,
  name       VARCHAR(120)      NOT NULL,
  quantity   DECIMAL(7,2)      NOT NULL,
  unit       VARCHAR(40)       NOT NULL,
  kcal       DECIMAL(6,1)      NOT NULL,
  protein_g  DECIMAL(6,1)      NOT NULL,
  carbs_g    DECIMAL(6,1)      NOT NULL,
  fat_g      DECIMAL(6,1)      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_diet_plan_meal_items_meal (meal_id, position),
  KEY idx_diet_plan_meal_items_client (client_id),
  CONSTRAINT fk_diet_plan_meal_items_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_diet_plan_meal_items_quantity CHECK (quantity > 0 AND quantity <= 10000),
  CONSTRAINT chk_diet_plan_meal_items_kcal CHECK (kcal BETWEEN 0 AND 5000),
  CONSTRAINT chk_diet_plan_meal_items_macros CHECK (protein_g BETWEEN 0 AND 2000 AND carbs_g BETWEEN 0 AND 2000 AND fat_g BETWEEN 0 AND 2000)
) ENGINE = InnoDB;

-- "Mark done": a plan meal eaten but not logged, per day (it never counts toward the macros)
CREATE TABLE diet_plan_completions (
  client_id  VARCHAR(64) NOT NULL,
  meal_id    CHAR(36)    NOT NULL,
  done_date  DATE        NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, meal_id, done_date),
  CONSTRAINT fk_diet_plan_completions_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------------------
-- WhatsApp gym agent (migration 2026-10-24-whatsapp-agent.sql). Gyms are never hard-deleted,
-- so gym-owned rows use ON DELETE RESTRICT; only a member's own rows cascade, one level below
-- users. Each gym gets its whatsapp_connections and whatsapp_agent_settings rows when it is
-- created (gyms/gyms.js), and the migration back-fills existing gyms.
-- ---------------------------------------------------------------------------------------

-- A member's plan at a gym, set by gym staff: the one record the agent reads for package status
CREATE TABLE gym_member_plans (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)     NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  plan_name   VARCHAR(80)  NOT NULL,
  price_label VARCHAR(40)  NULL,
  status      ENUM('active', 'paused', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
  starts_on   DATE         NOT NULL,
  ends_on     DATE         NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_member_plans_member (gym_id, user_id, status, ends_on),
  KEY idx_member_plans_user (user_id),
  CONSTRAINT fk_member_plans_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_member_plans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_member_plans_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
) ENGINE = InnoDB;

-- One per gym: the WhatsApp Business number it connected. The access token is encrypted with
-- AES-256-GCM (WHATSAPP_TOKEN_KEY) and never leaves the server.
CREATE TABLE whatsapp_connections (
  gym_id             CHAR(36)      NOT NULL,
  status             ENUM('disconnected', 'pending', 'connected', 'error') NOT NULL DEFAULT 'disconnected',
  waba_id            VARCHAR(32)   NULL,              -- WhatsApp Business Account id
  phone_number_id    VARCHAR(32)   NULL,              -- the id Meta's webhooks name; routes every message
  display_phone      VARCHAR(32)   NULL,
  token_ciphertext   VARBINARY(2048) NULL,
  token_iv           VARBINARY(12) NULL,
  token_tag          VARBINARY(16) NULL,
  token_expires_at   TIMESTAMP     NULL,              -- NULL: a token that doesn't expire
  webhook_subscribed BOOLEAN       NOT NULL DEFAULT FALSE,
  disabled_by_admin  BOOLEAN       NOT NULL DEFAULT FALSE,
  last_health_at     TIMESTAMP     NULL,
  last_error         VARCHAR(300)  NULL,              -- a safe summary, never a token or payload
  connected_by       VARCHAR(64)   NULL,
  connected_at       TIMESTAMP     NULL,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id),
  UNIQUE KEY uq_whatsapp_phone_number (phone_number_id),
  CONSTRAINT fk_whatsapp_connections_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_connections_by FOREIGN KEY (connected_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One per gym: whether the agent replies, and the owner's extra instructions
CREATE TABLE whatsapp_agent_settings (
  gym_id             CHAR(36)      NOT NULL,
  agent_status       ENUM('disabled', 'testing', 'active') NOT NULL DEFAULT 'disabled',
  instructions       VARCHAR(2000) NULL,
  escalation_contact VARCHAR(120)  NULL,
  daily_reply_limit  INT UNSIGNED  NOT NULL DEFAULT 500,
  updated_by         VARCHAR(64)   NULL,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id),
  CONSTRAINT fk_agent_settings_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_agent_settings_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_agent_reply_limit CHECK (daily_reply_limit BETWEEN 1 AND 10000)
) ENGINE = InnoDB;

-- Questions and answers the gym approved, used by the WhatsApp agent and the in-app assistant
CREATE TABLE gym_faqs (
  id         CHAR(36)         NOT NULL DEFAULT (UUID()),
  gym_id     CHAR(36)         NOT NULL,
  question   VARCHAR(200)     NOT NULL,
  answer     VARCHAR(1000)    NOT NULL,
  position   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active     BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_faqs_gym (gym_id, active, position),
  CONSTRAINT fk_gym_faqs_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- A WhatsApp number that wrote to (or opted in with) a gym. linked_user_id is set only after
-- the member proves both the EATO account and the number (whatsapp_link_codes).
CREATE TABLE whatsapp_contacts (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id             CHAR(36)     NOT NULL,
  wa_id              VARCHAR(20)  NOT NULL,             -- digits only, as Meta sends it
  profile_name       VARCHAR(120) NULL,
  linked_user_id     VARCHAR(64)  NULL,
  linked_at          TIMESTAMP    NULL,
  marketing_opt_in   BOOLEAN      NOT NULL DEFAULT FALSE,
  consent_source     VARCHAR(60)  NULL,
  consent_at         TIMESTAMP    NULL,
  opted_out_at       TIMESTAMP    NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_contacts_number (gym_id, wa_id),
  KEY idx_whatsapp_contacts_user (linked_user_id),
  CONSTRAINT fk_whatsapp_contacts_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_contacts_user FOREIGN KEY (linked_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One conversation per contact per gym
CREATE TABLE whatsapp_conversations (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id           CHAR(36)     NOT NULL,
  contact_id       CHAR(36)     NOT NULL,
  handler          ENUM('ai', 'human') NOT NULL DEFAULT 'ai',
  ai_paused        BOOLEAN      NOT NULL DEFAULT FALSE,
  status           ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
  unread_count     INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at  TIMESTAMP    NULL,
  last_inbound_at  TIMESTAMP    NULL,                   -- opens WhatsApp's 24-hour reply window
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_conversations_contact (gym_id, contact_id),
  KEY idx_whatsapp_conversations_inbox (gym_id, status, last_message_at),
  CONSTRAINT fk_whatsapp_conversations_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Media (images) received or sent; served only through the server to the gym's staff
CREATE TABLE whatsapp_media (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id            CHAR(36)     NOT NULL,
  provider_media_id VARCHAR(128) NULL,
  mime_type         VARCHAR(60)  NULL,
  size_bytes        INT UNSIGNED NULL,
  sha256            CHAR(64)     NULL,
  storage_name      VARCHAR(80)  NULL,                  -- file name under the upload folder, never a path from Meta
  status            ENUM('pending', 'stored', 'unavailable', 'unsupported') NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_whatsapp_media_gym (gym_id, created_at),
  CONSTRAINT fk_whatsapp_media_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Every message in or out. provider_message_id is unique, so a repeated webhook can't store twice.
CREATE TABLE whatsapp_messages (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id              CHAR(36)     NOT NULL,
  conversation_id     CHAR(36)     NOT NULL,
  direction           ENUM('in', 'out') NOT NULL,
  sender              ENUM('customer', 'ai', 'staff', 'campaign', 'system') NOT NULL,
  staff_user_id       VARCHAR(64)  NULL,
  type                ENUM('text', 'image', 'template', 'other') NOT NULL DEFAULT 'text',
  body                TEXT         NULL,
  media_id            CHAR(36)     NULL,
  provider_message_id VARCHAR(128) NULL,
  status              ENUM('received', 'queued', 'sent', 'delivered', 'read', 'failed') NOT NULL,
  error_code          VARCHAR(40)  NULL,
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  status_at           TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_messages_provider (provider_message_id),
  KEY idx_whatsapp_messages_conversation (gym_id, conversation_id, created_at),
  CONSTRAINT fk_whatsapp_messages_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_messages_staff FOREIGN KEY (staff_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One-time codes that link a WhatsApp number to a signed-in member. Only a hash is stored.
CREATE TABLE whatsapp_link_codes (
  id         CHAR(36)    NOT NULL DEFAULT (UUID()),
  gym_id     CHAR(36)    NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  code_hash  CHAR(64)    NOT NULL,
  attempts   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at TIMESTAMP   NOT NULL,
  used_at    TIMESTAMP   NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_link_codes_hash (gym_id, code_hash),
  KEY idx_whatsapp_link_codes_user (user_id, created_at),
  CONSTRAINT fk_whatsapp_link_codes_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_link_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Each webhook event once (event_key), saved before it's processed; purged after 30 days
CREATE TABLE whatsapp_webhook_events (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  event_key       VARCHAR(160) NOT NULL,
  phone_number_id VARCHAR(32)  NULL,
  gym_id          CHAR(36)     NULL,                    -- resolved by the server from phone_number_id
  kind            ENUM('message', 'status', 'other') NOT NULL,
  payload         JSON         NOT NULL,
  status          ENUM('pending', 'processed', 'ignored', 'failed', 'quarantined') NOT NULL DEFAULT 'pending',
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error      VARCHAR(300) NULL,
  received_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at    TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_webhook_events_key (event_key),
  KEY idx_whatsapp_webhook_events_status (status, received_at),
  CONSTRAINT fk_whatsapp_webhook_events_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- A small durable job queue polled by the server's worker
CREATE TABLE jobs (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  kind            VARCHAR(40)  NOT NULL,
  gym_id          CHAR(36)     NULL,
  payload         JSON         NOT NULL,
  status          ENUM('queued', 'running', 'done', 'failed') NOT NULL DEFAULT 'queued',
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts    TINYINT UNSIGNED NOT NULL DEFAULT 5,
  run_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at       TIMESTAMP    NULL,
  locked_by       VARCHAR(60)  NULL,
  last_error      VARCHAR(300) NULL,
  idempotency_key VARCHAR(160) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_idempotency (idempotency_key),
  KEY idx_jobs_due (status, run_at),
  CONSTRAINT fk_jobs_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Message templates as Meta reports them (synced; only approved ones can be sent)
CREATE TABLE whatsapp_templates (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)     NOT NULL,
  name        VARCHAR(512) NOT NULL,
  language    VARCHAR(15)  NOT NULL,
  category    ENUM('marketing', 'utility', 'authentication') NOT NULL,
  status      ENUM('approved', 'pending', 'rejected', 'paused', 'disabled') NOT NULL,
  body_params TINYINT UNSIGNED NOT NULL DEFAULT 0,
  has_image   BOOLEAN      NOT NULL DEFAULT FALSE,
  synced_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_templates (gym_id, name(191), language),
  CONSTRAINT fk_whatsapp_templates_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE whatsapp_campaigns (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id               CHAR(36)     NOT NULL,
  title                VARCHAR(120) NOT NULL,
  body                 VARCHAR(1024) NULL,
  media_id             CHAR(36)     NULL,
  template_id          CHAR(36)     NULL,
  segment              ENUM('active_members', 'expiring_members', 'expired_members', 'opted_in_contacts') NOT NULL,
  status               ENUM('draft', 'scheduled', 'sending', 'done', 'cancelled', 'failed') NOT NULL DEFAULT 'draft',
  recipient_count      INT UNSIGNED NOT NULL DEFAULT 0,
  estimated_cost_minor INT UNSIGNED NULL,               -- an estimate, in the pricing table's currency
  currency             CHAR(3)      NULL,
  scheduled_at         TIMESTAMP    NULL,
  created_by           VARCHAR(64)  NULL,
  confirmed_by         VARCHAR(64)  NULL,
  confirmed_at         TIMESTAMP    NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_whatsapp_campaigns_gym (gym_id, created_at),
  CONSTRAINT fk_whatsapp_campaigns_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_campaigns_created FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_whatsapp_campaigns_confirmed FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One row per recipient per campaign, so a retry never sends twice
CREATE TABLE whatsapp_campaign_recipients (
  campaign_id CHAR(36)     NOT NULL,
  contact_id  CHAR(36)     NOT NULL,
  gym_id      CHAR(36)     NOT NULL,
  status      ENUM('pending', 'sent', 'delivered', 'read', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  message_id  CHAR(36)     NULL,
  error_code  VARCHAR(40)  NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id, contact_id),
  KEY idx_campaign_recipients_status (campaign_id, status),
  CONSTRAINT fk_campaign_recipients_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Daily counts per gym and category, with estimated costs (labelled as estimates)
CREATE TABLE whatsapp_usage (
  gym_id               CHAR(36)     NOT NULL,
  day                  DATE         NOT NULL,
  kind                 ENUM('inbound', 'service', 'utility', 'marketing', 'authentication', 'ai') NOT NULL,
  count                INT UNSIGNED NOT NULL DEFAULT 0,
  ai_input_tokens      INT UNSIGNED NOT NULL DEFAULT 0,
  ai_output_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
  estimated_cost_minor INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (gym_id, day, kind),
  CONSTRAINT fk_whatsapp_usage_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- The rate card the estimates use; platform admins keep it current
CREATE TABLE whatsapp_pricing (
  category       ENUM('service', 'utility', 'marketing', 'authentication', 'ai_input_1k', 'ai_output_1k') NOT NULL,
  market         VARCHAR(8)   NOT NULL DEFAULT 'IN',
  price_minor    INT UNSIGNED NOT NULL,                 -- per message (or per 1,000 AI tokens)
  currency       CHAR(3)      NOT NULL DEFAULT 'INR',
  effective_from DATE         NOT NULL,
  note           VARCHAR(200) NULL,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (category, market, effective_from)
) ENGINE = InnoDB;

-- Who did what (connect, disconnect, settings, campaigns, admin actions); never a secret
CREATE TABLE whatsapp_audit (
  id         CHAR(36)    NOT NULL DEFAULT (UUID()),
  gym_id     CHAR(36)    NULL,
  actor_id   VARCHAR(64) NULL,
  action     VARCHAR(60) NOT NULL,
  detail     JSON        NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_whatsapp_audit_gym (gym_id, created_at),
  CONSTRAINT fk_whatsapp_audit_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
