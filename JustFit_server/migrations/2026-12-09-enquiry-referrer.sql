-- Enquiry referrals (asked for by the user on 2026-11-08): when an enquiry came from a referral,
-- Add Enquiry takes the mobile number of the person who referred them. When that number is one
-- of the branch's members, the enquiry shows the member's name and ID (read live, nothing copied).
-- In order:
--   1. gym_enquiries gets referred_by_phone (NULL: not a referral, or entered before this)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Before it runs, enquiries
-- keep working without the number, and saving a referral says this migration is needed. Run
-- after 2026-12-08-gym-logos.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-09-enquiry-referrer.sql

-- 1. The referrer's mobile number (10 digits, like every phone in the gym tables)
SET @has_referrer := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'referred_by_phone');
SET @sql := IF(@has_referrer = 0, 'ALTER TABLE gym_enquiries ADD COLUMN referred_by_phone CHAR(10) NULL AFTER source, ADD CONSTRAINT chk_gym_enquiries_referrer CHECK (referred_by_phone IS NULL OR referred_by_phone REGEXP ''^[6-9][0-9]{9}$'')', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
