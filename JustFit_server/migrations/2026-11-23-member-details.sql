-- Member details, due dates and PT periods (asked for by the user on 2026-11-04). Add New Member
-- gains optional fields (email, height, weight, address, notes); when part of the fee is still
-- owed, the date it should be paid by (past it, the member is overdue); and a PT payment records
-- the period it covers (shown as the member's PT, with its dates). In order:
--   1. gym_members gets email, height_cm, weight_kg, address, notes, due_by, pt_label, pt_from, pt_until
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-22-member-codes.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-23-member-details.sql

-- 1. The optional details and the date an amount owed should be paid by
SET @has_due_by := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'due_by');
SET @sql := IF(@has_due_by = 0, 'ALTER TABLE gym_members
  ADD COLUMN email VARCHAR(120) NULL AFTER gender,
  ADD COLUMN height_cm SMALLINT UNSIGNED NULL AFTER email,
  ADD COLUMN weight_kg DECIMAL(5,1) NULL AFTER height_cm,
  ADD COLUMN address VARCHAR(200) NULL AFTER weight_kg,
  ADD COLUMN notes VARCHAR(300) NULL AFTER address,
  ADD COLUMN due_by DATE NULL AFTER due_amount,
  ADD COLUMN pt_label VARCHAR(60) NULL AFTER due_by,
  ADD COLUMN pt_from DATE NULL AFTER pt_label,
  ADD COLUMN pt_until DATE NULL AFTER pt_from,
  ADD KEY idx_gym_members_due_by (gym_id, due_by),
  ADD CONSTRAINT chk_gym_members_height CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 250),
  ADD CONSTRAINT chk_gym_members_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 10 AND 300)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
