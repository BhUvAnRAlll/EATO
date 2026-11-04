-- Member IDs and gender (asked for by the user on 2026-11-04). Every member gets an ID made
-- from their gym's and branch's names and a running number per branch, e.g. FOR-TUM-0001 for
-- Forma's Tumkur branch. The server assigns it when the member is saved (gyms.next_member_no,
-- locked in the same transaction), so it is never typed and never repeats. It is kept when the
-- gym or branch is renamed. In order:
--   1. gym_members gets member_code and gender
--   2. gyms gets next_member_no
--   3. existing members get IDs in the order they joined, and each branch's counter follows on
--   4. member_code becomes required and unique per branch
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-21-gym-catalog.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-22-member-codes.sql

-- 1. The member's ID and gender
SET @has_code := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'member_code');
SET @sql := IF(@has_code = 0, 'ALTER TABLE gym_members ADD COLUMN member_code VARCHAR(16) NULL AFTER gym_id, ADD COLUMN gender ENUM(''male'', ''female'', ''other'') NULL AFTER dob', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Each branch's next number
SET @has_next := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'next_member_no');
SET @sql := IF(@has_next = 0, 'ALTER TABLE gyms ADD COLUMN next_member_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER city', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. IDs for the members already there (letters only, upper case, 3 of each name; GYM / BR when a
--    name has no letters), then the counters
UPDATE gym_members m
  JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY gym_id ORDER BY id) AS n FROM gym_members) x ON x.id = m.id
  JOIN gyms g ON g.id = m.gym_id
  JOIN gym_brands b ON b.id = g.brand_id
  SET m.member_code = CONCAT(
    IF(REGEXP_REPLACE(b.name, '[^A-Za-z]', '') = '', 'GYM', UPPER(LEFT(REGEXP_REPLACE(b.name, '[^A-Za-z]', ''), 3))), '-',
    IF(REGEXP_REPLACE(g.name, '[^A-Za-z]', '') = '', 'BR', UPPER(LEFT(REGEXP_REPLACE(g.name, '[^A-Za-z]', ''), 3))), '-',
    LPAD(x.n, 4, '0'))
  WHERE m.member_code IS NULL;
UPDATE gyms g SET g.next_member_no = (SELECT COUNT(*) FROM gym_members m WHERE m.gym_id = g.id) + 1
  WHERE g.next_member_no <= (SELECT COUNT(*) FROM gym_members m WHERE m.gym_id = g.id);

-- 4. Required and unique per branch
SET @nullable := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'member_code' AND IS_NULLABLE = 'YES');
SET @sql := IF(@nullable = 1, 'ALTER TABLE gym_members MODIFY member_code VARCHAR(16) NOT NULL, ADD UNIQUE KEY uq_gym_members_code (gym_id, member_code)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
