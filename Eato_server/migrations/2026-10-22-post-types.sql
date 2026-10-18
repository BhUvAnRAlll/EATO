-- Post types for Create Post: Photo, Progress, Meal, Achievement, Question and Poll, with the
-- details each type carries, an optional location, tagged friends and poll options and votes.
-- Adds to an existing database; safe to run more than once. schema.sql has all of this for a
-- fresh install. Needs 2026-10-20-gyms.sql first. Run by hand with an account allowed to
-- create and alter tables (eato_app can't), e.g.:
--   mysql -u root -p eato < migrations/2026-10-22-post-types.sql
--
-- Cascades stay one level below a table that cascades from users (posts), because a chain
-- three levels deep orphans rows on this MySQL version. A vote's option is an indexed column
-- the server checks, not a foreign key, for the same reason.

ALTER TABLE community_posts
  MODIFY category ENUM('general', 'meal', 'workout', 'progress', 'achievement', 'photo', 'question', 'poll') NOT NULL DEFAULT 'general';

-- MySQL has no ADD COLUMN IF NOT EXISTS: each column is checked first
SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'headline') = 0,
  'ALTER TABLE community_posts ADD COLUMN headline VARCHAR(120) NULL AFTER body',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'detail') = 0,
  'ALTER TABLE community_posts ADD COLUMN detail VARCHAR(300) NULL AFTER headline',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'detail_date') = 0,
  'ALTER TABLE community_posts ADD COLUMN detail_date DATE NULL AFTER detail',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'meal_kcal') = 0,
  'ALTER TABLE community_posts ADD COLUMN meal_kcal SMALLINT UNSIGNED NULL AFTER detail_date, ADD CONSTRAINT chk_posts_meal_kcal CHECK (meal_kcal <= 5000)',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'meal_protein_g') = 0,
  'ALTER TABLE community_posts ADD COLUMN meal_protein_g SMALLINT UNSIGNED NULL AFTER meal_kcal, ADD CONSTRAINT chk_posts_meal_protein CHECK (meal_protein_g <= 500)',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @add := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'location') = 0,
  'ALTER TABLE community_posts ADD COLUMN location VARCHAR(120) NULL AFTER meal_protein_g',
  'SELECT 1'
);
PREPARE statement FROM @add; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Friends tagged on a post ("with Sarah Chen"): accepted friends only, checked by the server
CREATE TABLE IF NOT EXISTS community_post_tags (
  post_id     CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  PRIMARY KEY (post_id, user_id),
  KEY idx_post_tags_user (user_id),
  CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_tags_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- A poll's choices, 2 to 6, in order; fixed once the poll is posted
CREATE TABLE IF NOT EXISTS community_poll_options (
  id        CHAR(36)         NOT NULL DEFAULT (UUID()),
  post_id   CHAR(36)         NOT NULL,
  position  TINYINT UNSIGNED NOT NULL,
  label     VARCHAR(80)      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_poll_options_position (post_id, position),
  CONSTRAINT fk_poll_options_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- One vote per member per poll (changing it replaces the row). option_id is checked by the
-- server against the poll's options; it is not a foreign key (see the cascade note above).
CREATE TABLE IF NOT EXISTS community_poll_votes (
  post_id     CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  option_id   CHAR(36)    NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  KEY idx_poll_votes_option (option_id),
  CONSTRAINT fk_poll_votes_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_poll_votes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
