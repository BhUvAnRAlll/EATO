-- Community stories: audiences (Everyone, Followers, Close Friends), soft deletion so a
-- report keeps its context, story reports, and each member's Close Friends list.
-- Adds to an existing database; safe to run more than once. schema.sql already has all of
-- this for a fresh install. Run by hand after 2026-10-15-post-media.sql, for example:
--   mysql -u root -p justfit < migrations/2026-10-16-stories.sql
-- MySQL has no ADD COLUMN IF NOT EXISTS, so each change checks INFORMATION_SCHEMA first.

-- community_stories.audience
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_stories' AND COLUMN_NAME = 'audience') = 0,
  'ALTER TABLE community_stories ADD COLUMN audience ENUM(''public'', ''followers'', ''close_friends'') NOT NULL DEFAULT ''public'' AFTER caption',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- community_stories.deleted_at
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_stories' AND COLUMN_NAME = 'deleted_at') = 0,
  'ALTER TABLE community_stories ADD COLUMN deleted_at TIMESTAMP NULL AFTER expires_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- community_reports.story_id with its foreign key
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_reports' AND COLUMN_NAME = 'story_id') = 0,
  'ALTER TABLE community_reports ADD COLUMN story_id CHAR(36) NULL AFTER comment_id, ADD CONSTRAINT fk_reports_story FOREIGN KEY (story_id) REFERENCES community_stories (id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The report target check: exactly one of post, comment or story. The old check (post or
-- comment) is replaced; re-running replaces it with the same definition.
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_reports' AND CONSTRAINT_NAME = 'chk_reports_target') > 0,
  'ALTER TABLE community_reports DROP CHECK chk_reports_target',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE community_reports
  ADD CONSTRAINT chk_reports_target CHECK ((post_id IS NOT NULL) + (comment_id IS NOT NULL) + (story_id IS NOT NULL) = 1);

CREATE TABLE IF NOT EXISTS community_close_friends (
  owner_id    VARCHAR(64) NOT NULL,
  friend_id   VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_id, friend_id),
  KEY idx_close_friends_friend (friend_id),
  CONSTRAINT fk_close_friends_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_close_friends_friend FOREIGN KEY (friend_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
