-- Gym Hub phase 4, asking to join from the app (approved by the user on 2026-11-09): a member picks
-- a plan on a gym's page in Gym Hub and sends a join request. It lands in that branch's Enquiries
-- like any other lead, marked "justFit app", with the plan picked. There is no payment. In order:
--   1. gym_enquiries.source gets 'app'
--   2. gym_enquiries gets user_id (the member's account that sent it; NULL for the gym's own
--      enquiries), catalog_item_id (the plan or PT package picked; NULL once that item is deleted)
--      and plan_label (the plan as it read when sent: "Gold · 3 Months · ₹4,500")
--   3. an index to find a member's own requests
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-12-18-enquiry-contact-notes.sql, by hand, with an account allowed to alter tables, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-19-gym-app-enquiries.sql

-- 1. The new source
ALTER TABLE gym_enquiries MODIFY COLUMN source ENUM('walk_in', 'call', 'whatsapp', 'instagram', 'referral', 'other', 'app') NULL;

-- 2. Who sent it and what they picked
SET @has_user := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'user_id');
SET @sql := IF(@has_user = 0, 'ALTER TABLE gym_enquiries ADD COLUMN user_id VARCHAR(64) NULL AFTER member_id, ADD COLUMN catalog_item_id INT UNSIGNED NULL AFTER user_id, ADD COLUMN plan_label VARCHAR(120) NULL AFTER catalog_item_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND CONSTRAINT_NAME = 'fk_gym_enquiries_user');
SET @sql := IF(@has_fk = 0, 'ALTER TABLE gym_enquiries ADD CONSTRAINT fk_gym_enquiries_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL, ADD CONSTRAINT fk_gym_enquiries_item FOREIGN KEY (catalog_item_id) REFERENCES gym_catalog_items (id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. A member's own requests
SET @has_key := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND INDEX_NAME = 'idx_gym_enquiries_user');
SET @sql := IF(@has_key = 0, 'ALTER TABLE gym_enquiries ADD KEY idx_gym_enquiries_user (user_id, gym_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
