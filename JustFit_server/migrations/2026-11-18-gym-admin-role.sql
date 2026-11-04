-- The gym admin role (asked for by the user on 2026-11-04): a third value for users.role,
-- `gym_admin`, that opens the gym admin portal (the app's app/gym/ screens) instead of the
-- member app or the Super Admin portal. Nobody gets it by signing in: only
-- `npm run set-role -- <phone> gym_admin` gives it. In order:
--   1. users.role accepts 'gym_admin' (every existing row keeps its role)
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run by hand, with an
-- account allowed to alter tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-18-gym-admin-role.sql

-- 1. The new role
SET @has_role := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
    AND COLUMN_TYPE LIKE '%''gym_admin''%'
);
SET @sql := IF(@has_role = 0, 'ALTER TABLE users MODIFY role ENUM(''user'', ''admin'', ''gym_admin'') NOT NULL DEFAULT ''user''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
