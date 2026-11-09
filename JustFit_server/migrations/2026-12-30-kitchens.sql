-- Meal Operations phase 1 (2026-11-10, MEAL-OPERATIONS-PLAN.md): the kitchens the Super Admin runs.
-- Each kitchen has its details, opening hours, the pincodes it serves, its capacity, a status
-- (active, inactive, temporarily closed, under maintenance) and a staff roster (no logins yet:
-- the user's choice). Orders are not yet assigned to kitchens (phase 3). Members never see kitchens.
-- Run once, after 2026-12-28 (and 2026-12-29 if present):
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-30-kitchens.sql

CREATE TABLE IF NOT EXISTS kitchens (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,    -- shown as KIT-0001
  name               VARCHAR(80)   NOT NULL,
  contact_name       VARCHAR(60)   NOT NULL,
  phone              CHAR(10)      NOT NULL,
  email              VARCHAR(120)  NULL,
  address            VARCHAR(200)  NOT NULL,
  area               VARCHAR(60)   NULL,
  city               VARCHAR(40)   NOT NULL,
  pincode            CHAR(6)       NOT NULL,
  latitude           DECIMAL(9,6)  NULL,
  longitude          DECIMAL(9,6)  NULL,
  opening_hours      JSON          NOT NULL,                   -- { mon: [["06:00","22:00"]], …, sun: [] }
  max_daily_orders   SMALLINT UNSIGNED NOT NULL,
  prep_capacity      SMALLINT UNSIGNED NOT NULL,               -- meals it can make for one meal time
  radius_km          DECIMAL(4,1)  NOT NULL,
  status             ENUM('active', 'inactive', 'temporarily_closed', 'maintenance') NOT NULL DEFAULT 'active',
  status_note        VARCHAR(200)  NULL,
  status_changed_at  TIMESTAMP     NULL,
  image_key          VARCHAR(64)   NULL,                       -- a photo the admin uploaded (meals/photos.js)
  created_by         VARCHAR(64)   NULL,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kitchens_name (name),
  KEY idx_kitchens_status (status),
  CONSTRAINT fk_kitchens_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_kitchens_pincode CHECK (pincode REGEXP '^[1-9][0-9]{5}$'),
  CONSTRAINT chk_kitchens_phone CHECK (phone REGEXP '^[6-9][0-9]{9}$')
) ENGINE = InnoDB;

-- The pincodes a kitchen delivers to (a pincode may be served by several kitchens)
CREATE TABLE IF NOT EXISTS kitchen_pincodes (
  kitchen_id  INT UNSIGNED NOT NULL,
  pincode     CHAR(6)      NOT NULL,
  PRIMARY KEY (kitchen_id, pincode),
  KEY idx_kitchen_pincodes_pincode (pincode),
  CONSTRAINT fk_kitchen_pincodes_kitchen FOREIGN KEY (kitchen_id) REFERENCES kitchens (id) ON DELETE CASCADE,
  CONSTRAINT chk_kitchen_pincodes_pincode CHECK (pincode REGEXP '^[1-9][0-9]{5}$')
) ENGINE = InnoDB;

-- The kitchen's people: managers, chefs and preparation staff (a roster; they don't sign in)
CREATE TABLE IF NOT EXISTS kitchen_staff (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kitchen_id  INT UNSIGNED NOT NULL,
  name        VARCHAR(60)  NOT NULL,
  phone       CHAR(10)     NOT NULL,
  role        ENUM('manager', 'chef', 'prep') NOT NULL,
  available   TINYINT(1)   NOT NULL DEFAULT 1,
  note        VARCHAR(120) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kitchen_staff_phone (kitchen_id, phone),
  CONSTRAINT fk_kitchen_staff_kitchen FOREIGN KEY (kitchen_id) REFERENCES kitchens (id) ON DELETE CASCADE,
  CONSTRAINT chk_kitchen_staff_phone CHECK (phone REGEXP '^[6-9][0-9]{9}$')
) ENGINE = InnoDB;

-- The admin's log names kitchens
ALTER TABLE admin_audit_log
  MODIFY COLUMN target_type ENUM('user', 'gym', 'post', 'report', 'promotion', 'exercise', 'program', 'section', 'meal', 'order', 'kitchen') NOT NULL;
