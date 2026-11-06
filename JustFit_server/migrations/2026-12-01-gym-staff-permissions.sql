-- Role & Permission (asked for by the user on 2026-11-06): the gym admin chooses which areas of
-- the portal each Staff login can use at a branch (members, payments, enquiries, catalog,
-- attendance, sms, predictions). gym_staff.permissions holds the list as JSON for a Staff row;
-- NULL means every area, which is what every Staff login has today, so nothing changes until the
-- gym admin edits someone. The gym admin (owner) and trainers never carry a value.
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-30-gym-enquiry-contacts.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-01-gym-staff-permissions.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_staff' AND COLUMN_NAME = 'permissions');
SET @sql := IF(@has = 0, "ALTER TABLE gym_staff ADD COLUMN permissions JSON NULL AFTER kind", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
