-- Removes the Groups feature's data for good (Groups left the app and the API in 2026-10-17's
-- release; the user approved deleting what remained on 2026-10-18). Deletes old group posts
-- (their comments, likes, photos-on-post rows and reports go with them through the posts'
-- own cascades), then community_posts.group_id with its foreign key and index, then the two
-- group tables. Group cover images become unattached uploads, which the orphan sweep removes.
-- Safe to run more than once: each step checks first. Run after 2026-10-22-post-types.sql, by
-- hand, with an account allowed to alter and drop tables (justfit_app can't), for example:
--   mysql -u root -p justfit < migrations/2026-10-23-drop-groups.sql
-- This deletes data and can't be undone: back up the database first.

-- 1. Old group posts (only while the column still exists)
SET @has_group_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'group_id'
);
SET @delete_group_posts := IF(@has_group_id = 1, 'DELETE FROM community_posts WHERE group_id IS NOT NULL', 'SELECT 1');
PREPARE delete_group_posts FROM @delete_group_posts;
EXECUTE delete_group_posts;
DEALLOCATE PREPARE delete_group_posts;

-- 2. The foreign key, then the index and the column
SET @has_group_fk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND CONSTRAINT_NAME = 'fk_posts_group'
);
SET @drop_group_fk := IF(@has_group_fk = 1, 'ALTER TABLE community_posts DROP FOREIGN KEY fk_posts_group', 'SELECT 1');
PREPARE drop_group_fk FROM @drop_group_fk;
EXECUTE drop_group_fk;
DEALLOCATE PREPARE drop_group_fk;

SET @has_group_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND INDEX_NAME = 'idx_posts_group'
);
SET @drop_group_index := IF(@has_group_index > 0, 'ALTER TABLE community_posts DROP INDEX idx_posts_group', 'SELECT 1');
PREPARE drop_group_index FROM @drop_group_index;
EXECUTE drop_group_index;
DEALLOCATE PREPARE drop_group_index;

SET @drop_group_column := IF(@has_group_id = 1, 'ALTER TABLE community_posts DROP COLUMN group_id', 'SELECT 1');
PREPARE drop_group_column FROM @drop_group_column;
EXECUTE drop_group_column;
DEALLOCATE PREPARE drop_group_column;

-- 3. The group tables (members first: they reference the groups)
DROP TABLE IF EXISTS community_group_members;
DROP TABLE IF EXISTS community_groups;
