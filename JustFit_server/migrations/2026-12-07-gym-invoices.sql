-- Invoices (asked for by the user on 2026-11-07): every gym payment gets an invoice of its own,
-- shown on the Invoice screen (the member's ⋯ › Send Invoice, a payment's Invoice chip) and shared
-- as a PDF. In order:
--   1. gyms gets next_invoice_no, the branch's running invoice number (like next_member_no), and
--      the details printed on an invoice: address, phone and GSTIN (all optional, the gym admin
--      fills them in under Branch details › Invoice details)
--   2. gym_payments gets invoice_no, unique per branch; a payment saved before this migration
--      has none and is numbered the first time its invoice is opened (gym/invoices.js)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-12-06-payment-receipts.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-07-gym-invoices.sql

-- 1. The branch's invoice counter and its invoice details
SET @has_counter := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'next_invoice_no');
SET @sql := IF(@has_counter = 0, 'ALTER TABLE gyms ADD COLUMN next_invoice_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER next_member_no', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_address := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'address');
SET @sql := IF(@has_address = 0, 'ALTER TABLE gyms ADD COLUMN address VARCHAR(160) NULL AFTER city, ADD COLUMN phone CHAR(10) NULL AFTER address, ADD COLUMN gstin CHAR(15) NULL AFTER phone', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The payment's invoice number, unique per branch
SET @has_invoice := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_payments' AND COLUMN_NAME = 'invoice_no');
SET @sql := IF(@has_invoice = 0, 'ALTER TABLE gym_payments ADD COLUMN invoice_no INT UNSIGNED NULL AFTER receipt_key, ADD UNIQUE KEY uq_gym_payments_invoice (gym_id, invoice_no)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
