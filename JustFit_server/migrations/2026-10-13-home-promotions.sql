-- Adds the admin-managed home screen tables to an existing justFit database.
-- Fresh databases get them from schema.sql; run this once on a database created before it.
--
--   mysql -u root -p eato < migrations/2026-10-13-home-promotions.sql
--
-- Safe to run more than once: tables are created only if missing and seed rows are skipped
-- when they already exist (INSERT IGNORE). Existing rows are never changed.

-- Hero promotions on the home screen (the carousel). Admins manage them from the app's
-- admin area. A promotion is shown to members only while status = 'published' and the
-- current time is inside [starts_at, ends_at); NULL means no limit on that side.
-- image_url is "asset:<key>" for an image bundled with the app or an https URL.
-- Buttons can only open screens from the server's allowlist (see home.js).
CREATE TABLE IF NOT EXISTS promotions (
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
CREATE TABLE IF NOT EXISTS home_content (
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

INSERT IGNORE INTO meals (id, name, description, image_url, diet, calories, protein_g, carbs_g, fat_g, price_paise, is_popular) VALUES
  ('grilled-chicken-bowl', 'Grilled Chicken Bowl', 'Grilled chicken, quinoa, broccoli and roasted sweet potato.', 'asset:meal-grilled-chicken', 'non-vegetarian', 470, 44, 38, 14, 29900, TRUE),
  ('paneer-tikka-bowl', 'Paneer Tikka Bowl', 'Tandoori paneer with brown rice and charred vegetables.', 'asset:meal-paneer-tikka', 'vegetarian', 540, 32, 58, 18, 27900, TRUE),
  ('salmon-bowl', 'Salmon Bowl', 'Grilled salmon, greens, avocado and lemon.', 'asset:meal-salmon', 'non-vegetarian', 560, 42, 48, 20, 34900, TRUE),
  ('lemon-herb-chicken-bowl', 'Lemon Herb Chicken Bowl', 'Lemon herb chicken with quinoa and roasted vegetables.', 'asset:meal-lemon-herb-chicken', 'non-vegetarian', 470, 44, 38, 14, 29900, FALSE);

INSERT IGNORE INTO home_content (id, nutrition_heading, nutrition_action_label, popular_heading, popular_action_label, today_heading, today_action_label, show_today_section, quick_actions, popular_meal_ids) VALUES
  (1, 'Today''s Nutrition', 'Edit Goal', 'Popular Meals', 'View all', 'Today', 'View all', TRUE,
   '[{"id":"meals","title":"Meals","subtitle":"Browse menu","icon":"meals","destination":"explore"},{"id":"plans","title":"Plans","subtitle":"For your goals","icon":"plans","destination":"plans"},{"id":"nutrition","title":"Nutrition","subtitle":"Track intake","icon":"nutrition","destination":"nutrition"},{"id":"delivery","title":"Delivery","subtitle":"At your doorstep","icon":"delivery","destination":"orders"}]',
   '["grilled-chicken-bowl","paneer-tikka-bowl","salmon-bowl"]');

-- promotions has no natural key, so each seed row is inserted only if its title isn't there yet
INSERT INTO promotions (title, eyebrow, headline, description, image_url, image_alt, cta_label, cta_destination, status, display_order)
  SELECT 'Chef-prepared meals', 'CHEF-PREPARED', 'Healthy meals for a stronger you', 'Nutritious, chef-prepared meals delivered to your doorstep.', 'asset:hero-bowl', 'Grilled chicken bowl with vegetables', 'Order Now', 'explore', 'published', 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE title = 'Chef-prepared meals');
INSERT INTO promotions (title, eyebrow, headline, description, image_url, image_alt, cta_label, cta_destination, status, display_order)
  SELECT 'Your fitness, your food', 'YOUR FITNESS, YOUR FOOD', 'Eat better. Reach your goals.', 'Delicious meals designed around your nutrition targets.', 'asset:hero-nutrition', 'Fresh ingredients on a board', 'Explore Meals', 'explore', 'published', 2 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE title = 'Your fitness, your food');
INSERT INTO promotions (title, eyebrow, headline, description, image_url, image_alt, cta_label, cta_destination, status, display_order)
  SELECT 'Fuel your day', 'FUEL YOUR DAY', 'Better nutrition starts here', 'Find meals that fit your lifestyle and daily macros.', 'asset:hero-delivery', 'Packed justFit meal boxes', 'View Menu', 'explore', 'published', 3 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE title = 'Fuel your day');
