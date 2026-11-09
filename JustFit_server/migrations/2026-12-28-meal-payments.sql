-- Meal payments, the Razorpay way (2026-11-10, the user's request: "the same way Razorpay will be
-- integrated, the dummy should be built"). Pay first saves the order as awaiting_payment and makes a
-- gateway order (meal_payments); the checkout answers with a payment id and a signature, and only
-- when the server has checked the signature is the order paid and placed. The provider is the
-- dummy until Razorpay is set up (PAYMENT_PROVIDER, payments/providers.js); no money is taken.
-- Unpaid orders are cancelled by the system after 15 minutes.
-- Run once, after 2026-12-27:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-28-meal-payments.sql

ALTER TABLE orders
  MODIFY COLUMN status ENUM('awaiting_payment', 'placed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled') NOT NULL DEFAULT 'placed',
  MODIFY COLUMN cancelled_by ENUM('member', 'admin', 'system') NULL,
  MODIFY COLUMN payment_method ENUM('test', 'dummy', 'razorpay') NULL;

-- One row per gateway order (Razorpay's order_…): what it is for, how much, and how it ended.
-- A member may try several times on one gateway order (as on Razorpay); the last attempt is kept.
CREATE TABLE IF NOT EXISTS meal_payments (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  order_id             CHAR(36)     NOT NULL,
  user_id              VARCHAR(64)  NOT NULL,
  provider             ENUM('dummy', 'razorpay') NOT NULL,
  provider_order_id    VARCHAR(40)  NOT NULL,
  provider_payment_id  VARCHAR(40)  NULL,
  amount_paise         INT UNSIGNED NOT NULL,
  currency             CHAR(3)      NOT NULL DEFAULT 'INR',
  status               ENUM('created', 'paid', 'failed') NOT NULL DEFAULT 'created',
  method               ENUM('upi', 'card', 'netbanking', 'wallet') NULL,
  failure_reason       VARCHAR(200) NULL,
  attempts             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  paid_at              TIMESTAMP    NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_payments_provider_order (provider_order_id),
  UNIQUE KEY uq_meal_payments_provider_payment (provider_payment_id),
  KEY idx_meal_payments_order (order_id),
  CONSTRAINT fk_meal_payments_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_payments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
