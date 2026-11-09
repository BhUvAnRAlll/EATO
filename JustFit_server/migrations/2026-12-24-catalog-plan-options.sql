-- Gym Profile Management, phase 2 (approved by the user on 2026-11-09): membership plans and PT
-- packages the gym manages for members to compare. Every catalogue item gets:
--   benefits    what's included, as a short list (plans and PT packages only)
--   best_value  the gym's own "Best value" plan (at most one a branch; plans only)
--   sort_order  the order the gym shows its items in (0 = after those it has ordered)
--   status      active (members see it, forms offer it), inactive (hidden for now, kept for
--               members on it) or archived (put away; out of the list unless shown)
-- Nothing is deleted; every existing item stays active. Safe to run more than once. Run by hand,
-- from JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-24-catalog-plan-options.sql

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND COLUMN_NAME = 'status');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_catalog_items
  ADD COLUMN benefits JSON NULL AFTER details,
  ADD COLUMN best_value TINYINT(1) NOT NULL DEFAULT 0 AFTER benefits,
  ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER best_value,
  ADD COLUMN status ENUM(''active'', ''inactive'', ''archived'') NOT NULL DEFAULT ''active'' AFTER sort_order', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND INDEX_NAME = 'idx_gym_catalog_status');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_catalog_items ADD KEY idx_gym_catalog_status (gym_id, kind, status, sort_order)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
