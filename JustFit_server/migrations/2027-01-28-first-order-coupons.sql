-- First-order coupons (2026-11-10, meal marketing phase 2b): the Super Admin can mark a coupon "first
-- order only". It is offered on the Meals tab only to members who have never placed an order (orders
-- cancelled or still waiting for payment don't count), and the order's transaction refuses it for
-- anyone else (meals/catalog.js couponFor). NULL never: existing coupons are 0, as they worked before.
--
-- Adds one column; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-28-first-order-coupons.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meal_coupons' AND COLUMN_NAME = 'first_order_only');
SET @sql := IF(@has = 0, 'ALTER TABLE meal_coupons ADD COLUMN first_order_only TINYINT(1) NOT NULL DEFAULT 0 AFTER per_member_limit', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
