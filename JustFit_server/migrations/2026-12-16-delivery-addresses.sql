-- Delivery addresses (2026-11-09): a member's saved addresses and the pincodes justFit delivers to.
-- Run once, after 2026-12-15:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-16-delivery-addresses.sql

-- A member's delivery addresses (Profile › Delivery addresses, 2026-11-09). The map pin's latitude
-- and longitude are kept, but the address is always what the member typed and checked: house or
-- flat, street and area, an optional landmark, and the pincode deliveries are checked against.
-- is_default is the selected address; it lives here so the choice survives restarts and
-- reinstalls. One per member is kept by addresses/service.js, which changes it only inside a
-- transaction holding the member's address rows locked (a unique key on a generated column can't
-- be used: MySQL refuses it on a column that cascades from users).
CREATE TABLE IF NOT EXISTS user_addresses (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id            VARCHAR(64)   NOT NULL,
  kind               ENUM('home', 'work', 'other') NOT NULL,
  receiver_name      VARCHAR(60)   NOT NULL,
  receiver_phone     CHAR(10)      NOT NULL,              -- 10 digits, +91 implied
  house              VARCHAR(120)  NOT NULL,              -- house, flat, floor, building
  street             VARCHAR(160)  NOT NULL,              -- apartment, street, area
  landmark           VARCHAR(120)  NULL,
  city               VARCHAR(80)   NULL,
  pincode            CHAR(6)       NOT NULL,
  formatted_address  VARCHAR(300)  NOT NULL,              -- the map's line for the pin, as the phone read it
  latitude           DECIMAL(9,6)  NOT NULL,
  longitude          DECIMAL(9,6)  NOT NULL,
  instructions       VARCHAR(200)  NULL,
  is_default         TINYINT(1)    NOT NULL DEFAULT 0,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_addresses_user (user_id),
  CONSTRAINT fk_user_addresses_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_user_addresses_phone CHECK (receiver_phone REGEXP '^[6-9][0-9]{9}$'),
  CONSTRAINT chk_user_addresses_pincode CHECK (pincode REGEXP '^[1-9][0-9]{5}$'),
  CONSTRAINT chk_user_addresses_lat CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_user_addresses_lng CHECK (longitude BETWEEN -180 AND 180)
) ENGINE = InnoDB;

-- The pincodes justFit delivers to (npm run delivery-pincode in JustFit_server adds, lists and
-- switches them off). An address outside the list is saved but marked as not deliverable yet.
CREATE TABLE IF NOT EXISTS delivery_pincodes (
  pincode     CHAR(6)       NOT NULL,
  area        VARCHAR(80)   NULL,
  active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (pincode),
  CONSTRAINT chk_delivery_pincodes_pincode CHECK (pincode REGEXP '^[1-9][0-9]{5}$')
) ENGINE = InnoDB;
