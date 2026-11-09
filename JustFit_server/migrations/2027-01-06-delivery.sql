-- Meal Operations phase 4 (2026-11-10, MEAL-OPERATIONS-PLAN.md): delivery partners and deliveries.
-- The Super Admin registers delivery partners (no rider logins yet: the user's choice) with their
-- vehicle, ID check, the pincodes they cover, whether they're available and how many orders they
-- carry at once, assigns an order to one (automatically or by hand) and records each step:
-- assigned → accepted → at the kitchen → picked up → out for delivery → at the customer →
-- delivered, or failed with a reason (then retried or cancelled). An order can now be 'failed'.
-- Run once, after 2027-01-05:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-06-delivery.sql

CREATE TABLE IF NOT EXISTS delivery_partners (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(60)  NOT NULL,
  phone           CHAR(10)     NOT NULL,
  vehicle         ENUM('bike', 'scooter', 'bicycle', 'car', 'on_foot') NOT NULL,
  vehicle_number  VARCHAR(16)  NULL,
  id_status       ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  available       TINYINT(1)   NOT NULL DEFAULT 1,
  max_orders      TINYINT UNSIGNED NOT NULL DEFAULT 3,       -- orders carried at once
  note            VARCHAR(120) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_partners_phone (phone),
  CONSTRAINT chk_delivery_partners_phone CHECK (phone REGEXP '^[6-9][0-9]{9}$'),
  CONSTRAINT chk_delivery_partners_max CHECK (max_orders BETWEEN 1 AND 10)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS delivery_partner_pincodes (
  partner_id  INT UNSIGNED NOT NULL,
  pincode     CHAR(6)      NOT NULL,
  PRIMARY KEY (partner_id, pincode),
  KEY idx_delivery_partner_pincodes_pincode (pincode),
  CONSTRAINT fk_delivery_partner_pincodes_partner FOREIGN KEY (partner_id) REFERENCES delivery_partners (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One delivery per order (a retry keeps the row and starts it again)
CREATE TABLE IF NOT EXISTS deliveries (
  order_id        CHAR(36)     NOT NULL,
  partner_id      INT UNSIGNED NULL,
  status          ENUM('assigned', 'accepted', 'at_kitchen', 'picked_up', 'out_for_delivery', 'at_customer', 'delivered', 'failed') NOT NULL DEFAULT 'assigned',
  failure_reason  ENUM('customer_unavailable', 'wrong_address', 'customer_rejected', 'partner_issue', 'other') NULL,
  failure_note    VARCHAR(200) NULL,
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  assigned_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  picked_up_at    TIMESTAMP    NULL,
  delivered_at    TIMESTAMP    NULL,
  failed_at       TIMESTAMP    NULL,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  KEY idx_deliveries_partner (partner_id, status),
  CONSTRAINT fk_deliveries_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_deliveries_partner FOREIGN KEY (partner_id) REFERENCES delivery_partners (id) ON DELETE SET NULL
) ENGINE = InnoDB;

ALTER TABLE orders
  MODIFY COLUMN status ENUM('awaiting_payment', 'placed', 'accepted', 'preparing', 'quality_check', 'ready', 'out_for_delivery', 'delivered', 'failed', 'cancelled') NOT NULL DEFAULT 'placed';
