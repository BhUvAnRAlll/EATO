-- Payment bills (asked for by the user on 2026-11-07): Add Member's last step has "Attach the
-- payment bill", a photo of the plan payment's receipt, uploaded once the admission is saved and
-- kept with that payment (gym_payments). The member's page shows a Bill button on the payment.
-- The image is a file on the server's disk (PAYMENT_RECEIPT_DIR, by default
-- uploads/payment-receipts, git-ignored; gym/paymentReceipts.js) under a random name; the row keeps
-- only that name, and only this branch's staff can read it. In order:
--   1. gym_payments gets receipt_key (NULL: no bill)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-12-05-membership-pauses.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-06-payment-receipts.sql

-- 1. The bill's file name
SET @has_receipt := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_payments' AND COLUMN_NAME = 'receipt_key');
SET @sql := IF(@has_receipt = 0, 'ALTER TABLE gym_payments ADD COLUMN receipt_key VARCHAR(64) NULL AFTER due_by', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
