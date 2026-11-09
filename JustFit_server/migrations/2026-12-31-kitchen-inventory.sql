-- Meal Operations phase 2 (2026-11-10, MEAL-OPERATIONS-PLAN.md): each kitchen's menu and stock.
-- kitchen_meals: which meals a kitchen cooks, on or off there. ingredients: the one list of
-- ingredients (name, category, unit). kitchen_stock: a kitchen's quantity of each, its minimum,
-- price, supplier, expiry and storage. stock_moves: every purchase, use, waste, count and
-- transfer, with the balance after it. meal_recipes and meal_prep: what one serving takes and how
-- long it takes to make (used from phase 3 to take stock when cooking starts). Quantities are in
-- the ingredient's own unit. Run once, after 2026-12-30:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-31-kitchen-inventory.sql

CREATE TABLE IF NOT EXISTS kitchen_meals (
  kitchen_id  INT UNSIGNED NOT NULL,
  meal_id     VARCHAR(64)  NOT NULL,
  available   TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (kitchen_id, meal_id),
  KEY idx_kitchen_meals_meal (meal_id),
  CONSTRAINT fk_kitchen_meals_kitchen FOREIGN KEY (kitchen_id) REFERENCES kitchens (id) ON DELETE CASCADE,
  CONSTRAINT fk_kitchen_meals_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS ingredients (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(60)  NOT NULL,
  category    ENUM('vegetables', 'fruits', 'grains', 'pulses', 'dairy', 'meat', 'seafood', 'eggs', 'oils', 'spices', 'packaging', 'other') NOT NULL,
  unit        ENUM('g', 'kg', 'ml', 'l', 'pcs') NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingredients_name (name)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS kitchen_stock (
  kitchen_id        INT UNSIGNED  NOT NULL,
  ingredient_id     INT UNSIGNED  NOT NULL,
  quantity          DECIMAL(12,3) NOT NULL DEFAULT 0,
  min_quantity      DECIMAL(12,3) NOT NULL DEFAULT 0,      -- below this it is low stock
  unit_price_paise  INT UNSIGNED  NULL,                    -- the last purchase price per unit
  supplier          VARCHAR(80)   NULL,
  expires_on        DATE          NULL,
  storage           VARCHAR(80)   NULL,                    -- "Cold room, shelf 2"
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (kitchen_id, ingredient_id),
  KEY idx_kitchen_stock_ingredient (ingredient_id),
  CONSTRAINT fk_kitchen_stock_kitchen FOREIGN KEY (kitchen_id) REFERENCES kitchens (id) ON DELETE CASCADE,
  CONSTRAINT fk_kitchen_stock_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients (id),
  CONSTRAINT chk_kitchen_stock_min CHECK (min_quantity >= 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS stock_moves (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kitchen_id        INT UNSIGNED  NOT NULL,
  ingredient_id     INT UNSIGNED  NOT NULL,
  kind              ENUM('purchase', 'use', 'waste', 'adjust', 'transfer_in', 'transfer_out') NOT NULL,
  quantity          DECIMAL(12,3) NOT NULL,                -- the change: + in, − out
  balance_after     DECIMAL(12,3) NOT NULL,
  unit_price_paise  INT UNSIGNED  NULL,
  note              VARCHAR(120)  NULL,
  overridden        TINYINT(1)    NOT NULL DEFAULT 0,      -- took more than was in stock, with a reason
  other_kitchen_id  INT UNSIGNED  NULL,                    -- a transfer's other kitchen
  created_by        VARCHAR(64)   NULL,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_stock_moves_kitchen (kitchen_id, created_at),
  KEY idx_stock_moves_item (kitchen_id, ingredient_id, created_at),
  CONSTRAINT fk_stock_moves_kitchen FOREIGN KEY (kitchen_id) REFERENCES kitchens (id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_moves_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients (id),
  CONSTRAINT fk_stock_moves_other FOREIGN KEY (other_kitchen_id) REFERENCES kitchens (id) ON DELETE SET NULL,
  CONSTRAINT fk_stock_moves_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS meal_recipes (
  meal_id        VARCHAR(64)   NOT NULL,
  ingredient_id  INT UNSIGNED  NOT NULL,
  quantity       DECIMAL(10,3) NOT NULL,                   -- per serving, in the ingredient's unit
  PRIMARY KEY (meal_id, ingredient_id),
  KEY idx_meal_recipes_ingredient (ingredient_id),
  CONSTRAINT fk_meal_recipes_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_recipes_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients (id),
  CONSTRAINT chk_meal_recipes_quantity CHECK (quantity > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS meal_prep (
  meal_id       VARCHAR(64)       NOT NULL,
  prep_minutes  SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (meal_id),
  CONSTRAINT fk_meal_prep_meal FOREIGN KEY (meal_id) REFERENCES meals (id) ON DELETE CASCADE,
  CONSTRAINT chk_meal_prep_minutes CHECK (prep_minutes BETWEEN 1 AND 600)
) ENGINE = InnoDB;
