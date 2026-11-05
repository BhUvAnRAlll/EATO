-- QR attendance (asked for by the user on 2026-11-04): members check in and out by scanning their
-- branch's QR code in the justFit app, within a radius of the branch's location; staff can still
-- check members in and out by hand. In order:
--   1. gyms gets the location (latitude, longitude), the radius (default 100 m) and the QR
--      code's version (0: none made yet)
--   2. gym_attendance gets check-out, status, duration, where each scan was made, and who
--      checked the member out. Existing check-ins are kept, marked 'no_checkout' (they had no
--      check-out) and 'staff' (staff made them).
--   3. one-a-day becomes one-open-visit-at-a-time: a new index on (member_id, on_date) first
--      (the member foreign key needs one), then the old unique key goes, then the open-visit key
--
-- Safe to run more than once: it checks first, and no row is deleted. Run after
-- 2026-11-26-member-photos.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-27-gym-qr-attendance.sql

-- 1. The branch's place, radius and QR version
SET @has_place := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'latitude');
SET @sql := IF(@has_place = 0, 'ALTER TABLE gyms
  ADD COLUMN latitude DECIMAL(9,6) NULL AFTER sms_credits,
  ADD COLUMN longitude DECIMAL(9,6) NULL AFTER latitude,
  ADD COLUMN attendance_radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 100 AFTER longitude,
  ADD COLUMN qr_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER attendance_radius_m,
  ADD COLUMN qr_made_at TIMESTAMP NULL AFTER qr_version,
  ADD CONSTRAINT chk_gyms_place CHECK ((latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))),
  ADD CONSTRAINT chk_gyms_radius CHECK (attendance_radius_m BETWEEN 20 AND 1000)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Check-out, status, duration and the scans' readings. status is added with the default
-- 'no_checkout' so every existing row gets it, then the default becomes 'inside'.
SET @has_status := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_attendance' AND COLUMN_NAME = 'status');
SET @sql := IF(@has_status = 0, 'ALTER TABLE gym_attendance
  ADD COLUMN checked_out_at TIMESTAMP NULL AFTER checked_in_at,
  ADD COLUMN status ENUM(''inside'', ''completed'', ''no_checkout'') NOT NULL DEFAULT ''no_checkout'' AFTER checked_out_at,
  ADD COLUMN duration_min SMALLINT UNSIGNED NULL AFTER status,
  ADD COLUMN in_source ENUM(''staff'', ''qr'') NOT NULL DEFAULT ''staff'' AFTER duration_min,
  ADD COLUMN out_source ENUM(''staff'', ''qr'') NULL AFTER in_source,
  ADD COLUMN check_in_lat DECIMAL(9,6) NULL AFTER out_source,
  ADD COLUMN check_in_lng DECIMAL(9,6) NULL AFTER check_in_lat,
  ADD COLUMN check_in_accuracy_m SMALLINT UNSIGNED NULL AFTER check_in_lng,
  ADD COLUMN check_in_distance_m SMALLINT UNSIGNED NULL AFTER check_in_accuracy_m,
  ADD COLUMN check_out_lat DECIMAL(9,6) NULL AFTER check_in_distance_m,
  ADD COLUMN check_out_lng DECIMAL(9,6) NULL AFTER check_out_lat,
  ADD COLUMN check_out_accuracy_m SMALLINT UNSIGNED NULL AFTER check_out_lng,
  ADD COLUMN check_out_distance_m SMALLINT UNSIGNED NULL AFTER check_out_accuracy_m,
  ADD COLUMN open_member_id INT UNSIGNED AS (IF(status = ''inside'', member_id, NULL)) STORED AFTER check_out_distance_m,
  ADD COLUMN checked_out_by VARCHAR(64) NULL AFTER created_by,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER checked_out_by', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE gym_attendance ALTER COLUMN status SET DEFAULT 'inside';

SET @has_fk := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_attendance' AND CONSTRAINT_NAME = 'fk_gym_attendance_checked_out_by');
SET @sql := IF(@has_fk = 0, 'ALTER TABLE gym_attendance ADD CONSTRAINT fk_gym_attendance_checked_out_by FOREIGN KEY (checked_out_by) REFERENCES users (id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Indexes: the member's visits by day, then the old one-a-day key goes, then one open visit per member
SET @has_idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_attendance' AND INDEX_NAME = 'idx_gym_attendance_member');
SET @sql := IF(@has_idx = 0, 'ALTER TABLE gym_attendance ADD KEY idx_gym_attendance_member (member_id, on_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_attendance' AND INDEX_NAME = 'uq_gym_attendance_day');
SET @sql := IF(@has_old > 0, 'ALTER TABLE gym_attendance DROP INDEX uq_gym_attendance_day', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_open := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_attendance' AND INDEX_NAME = 'uq_gym_attendance_open');
SET @sql := IF(@has_open = 0, 'ALTER TABLE gym_attendance ADD UNIQUE KEY uq_gym_attendance_open (open_member_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_status_idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_attendance' AND INDEX_NAME = 'idx_gym_attendance_status');
SET @sql := IF(@has_status_idx = 0, 'ALTER TABLE gym_attendance ADD KEY idx_gym_attendance_status (gym_id, status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
