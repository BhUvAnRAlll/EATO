-- Enquiry follow-up (asked for by the user on 2026-11-05): Manage › Enquiry keeps track of each
-- person who asked about joining until they join or say no. gym_enquiries gets, in order:
--   1. status: new, follow_up, joined or lost ("Not interested"); every existing enquiry is new
--   2. follow_up_on: the day to call them back (Today / Overdue in the app), or none
--   3. interest: membership, pt, trial or other (optional)
--   4. source: walk_in, call, whatsapp, instagram, referral or other (optional)
--   5. member_id: the member they became (Convert to member), or none
--   6. updated_at, and an index for the Today / Overdue / Open lists
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-27-gym-qr-attendance.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-28-gym-enquiry-followup.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'status');
SET @sql := IF(@has = 0, "ALTER TABLE gym_enquiries ADD COLUMN status ENUM('new', 'follow_up', 'joined', 'lost') NOT NULL DEFAULT 'new' AFTER note", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'follow_up_on');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_enquiries ADD COLUMN follow_up_on DATE NULL AFTER status', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'interest');
SET @sql := IF(@has = 0, "ALTER TABLE gym_enquiries ADD COLUMN interest ENUM('membership', 'pt', 'trial', 'other') NULL AFTER follow_up_on", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'source');
SET @sql := IF(@has = 0, "ALTER TABLE gym_enquiries ADD COLUMN source ENUM('walk_in', 'call', 'whatsapp', 'instagram', 'referral', 'other') NULL AFTER interest", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'member_id');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_enquiries ADD COLUMN member_id INT UNSIGNED NULL AFTER source, ADD CONSTRAINT fk_gym_enquiries_member FOREIGN KEY (member_id) REFERENCES gym_members (id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'updated_at');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_enquiries ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER created_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND INDEX_NAME = 'idx_gym_enquiries_followup');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_enquiries ADD KEY idx_gym_enquiries_followup (gym_id, status, follow_up_on)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
