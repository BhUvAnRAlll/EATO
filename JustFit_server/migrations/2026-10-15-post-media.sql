-- Community posts: several ordered images per post, a "workout" category, and a client key
-- that makes publishing idempotent (a repeated Publish tap can't save a second post).
-- Adds to an existing database; safe to run more than once. schema.sql already has all of
-- this for a fresh install. Run by hand against the development database, for example:
--   mysql -u root -p justfit < migrations/2026-10-15-post-media.sql

ALTER TABLE community_posts
  MODIFY category ENUM('general', 'meal', 'workout', 'progress', 'achievement') NOT NULL DEFAULT 'general';

-- client_key (MySQL has no ADD COLUMN IF NOT EXISTS, so the column is checked first)
SET @has_client_key := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'client_key'
);
SET @add_client_key := IF(
  @has_client_key = 0,
  'ALTER TABLE community_posts ADD COLUMN client_key CHAR(36) NULL AFTER media_id, ADD UNIQUE KEY uq_posts_client_key (user_id, client_key)',
  'SELECT 1'
);
PREPARE add_client_key FROM @add_client_key;
EXECUTE add_client_key;
DEALLOCATE PREPARE add_client_key;

CREATE TABLE IF NOT EXISTS community_post_media (
  post_id   CHAR(36)         NOT NULL,
  media_id  CHAR(36)         NOT NULL,
  position  TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (post_id, media_id),
  UNIQUE KEY uq_post_media_position (post_id, position),
  KEY idx_post_media_media (media_id),
  CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_media_media FOREIGN KEY (media_id) REFERENCES community_media (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Posts that already have one image get it as their first (and only) entry
INSERT IGNORE INTO community_post_media (post_id, media_id, position)
  SELECT id, media_id, 0 FROM community_posts WHERE media_id IS NOT NULL;
