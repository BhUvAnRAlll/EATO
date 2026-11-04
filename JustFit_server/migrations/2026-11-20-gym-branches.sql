-- Gym branches (asked for by the user on 2026-11-04: "Forma's branch is Tumkur"). A gym brand
-- (gym_brands, e.g. Forma) has branches; each `gyms` row is now one branch (its `name` is the
-- branch's name, e.g. Tumkur), and every member, payment, enquiry and check-in already belongs to
-- a branch through gym_id. A gym admin can be linked to several branches of one brand and
-- switches between them; the server remembers the last one chosen (gym_staff.selected_at).
-- Run after 2026-11-19-gym-portal.sql. In order:
--   1. creates gym_brands
--   2. gyms gets brand_id; every existing gym becomes the first branch of a brand with its name
--      (the branch is named after its area, which can be renamed in the app)
--   3. gyms.brand_id becomes required, with its foreign key
--   4. gym_staff: one row per account and branch (was one per account), plus selected_at
--   5. gym_payments.kind accepts 'pt' (personal training; asked for the same day). 'sale' is shown
--      as Product in the app
--   6. gym_members.dob (optional date of birth, for Home's birthdays today)
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run by hand, with
-- an account allowed to alter tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-20-gym-branches.sql

-- 1. Brands
CREATE TABLE IF NOT EXISTS gym_brands (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_gym_brands_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- 2. Each gym joins a brand of its own name, and is named after its area
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'brand_id');
SET @sql := IF(@has_col = 0, 'ALTER TABLE gyms ADD COLUMN brand_id INT UNSIGNED NULL AFTER id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- (the new brand takes the gym's id, so each gym finds its own even when two share a name)
INSERT INTO gym_brands (id, name, created_by)
  SELECT g.id, g.name, g.created_by FROM gyms g WHERE g.brand_id IS NULL AND NOT EXISTS (SELECT 1 FROM gym_brands b WHERE b.id = g.id);
UPDATE gyms SET brand_id = id, name = area WHERE brand_id IS NULL;

-- 3. Required, with its foreign key
SET @nullable := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'brand_id' AND IS_NULLABLE = 'YES');
SET @sql := IF(@nullable = 1, 'ALTER TABLE gyms MODIFY brand_id INT UNSIGNED NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_fk := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND CONSTRAINT_NAME = 'fk_gyms_brand');
SET @sql := IF(@has_fk = 0, 'ALTER TABLE gyms ADD KEY idx_gyms_brand (brand_id), ADD CONSTRAINT fk_gyms_brand FOREIGN KEY (brand_id) REFERENCES gym_brands (id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Staff on several branches, and the branch each last chose
SET @has_sel := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_staff' AND COLUMN_NAME = 'selected_at');
SET @sql := IF(@has_sel = 0, 'ALTER TABLE gym_staff ADD COLUMN selected_at TIMESTAMP(3) NULL AFTER added_at, DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, gym_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Personal training payments
SET @has_pt := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_payments' AND COLUMN_NAME = 'kind' AND COLUMN_TYPE LIKE '%''pt''%');
SET @sql := IF(@has_pt = 0, 'ALTER TABLE gym_payments MODIFY kind ENUM(''admission'', ''renewal'', ''due'', ''sale'', ''pt'') NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. Members' birthdays
SET @has_dob := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'dob');
SET @sql := IF(@has_dob = 0, 'ALTER TABLE gym_members ADD COLUMN dob DATE NULL AFTER phone', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
