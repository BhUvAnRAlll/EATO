-- Gym Hub ecosystem (the user's brief of 2026-11-09, G17): a plan's or PT package's terms and who
-- may buy it. `eligibility` is one line members read before asking ("Women only", "Students with a
-- college ID", "Off-peak: 10 am to 4 pm"); `terms` the plan's rules (freeze, transfer, refund).
-- Both optional, plans and PT only, shown on the gym's page.
--
-- Adds two columns; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-22-plan-terms.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND COLUMN_NAME = 'terms');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_catalog_items ADD COLUMN eligibility VARCHAR(120) NULL AFTER benefits, ADD COLUMN terms VARCHAR(600) NULL AFTER eligibility', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
