-- Adds the community tables (feed, stories, groups, direct messages) to an existing justFit database.
-- Fresh databases get them from schema.sql; run this once on a database created before it.
--
--   mysql -u root -p justfit < migrations/2026-10-14-community.sql
--
-- Safe to run more than once: tables are created only if missing and seed rows are skipped
-- when they already exist (INSERT IGNORE). Existing rows are never changed.

-- ---------------------------------------------------------------------------
-- Community: feed, stories, groups, direct messages
-- ---------------------------------------------------------------------------

-- An image a member uploaded (post, story or group cover). The bytes live on the server's
-- disk under uploads/<id>.<ext> and are served only to signed-in members; the row keeps
-- the owner, type and size so files can be checked and cleaned up.
CREATE TABLE IF NOT EXISTS community_media (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  media_type  ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL,
  byte_size   INT UNSIGNED NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_media_user (user_id),
  CONSTRAINT fk_media_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Discoverable groups. Seeded ones are public; private groups show only to their members.
CREATE TABLE IF NOT EXISTS community_groups (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  slug            VARCHAR(64)  NOT NULL,
  name            VARCHAR(80)  NOT NULL,
  topic           VARCHAR(40)  NOT NULL,            -- e.g. "Fat loss", searched with the name
  description     VARCHAR(300) NOT NULL,
  cover_media_id  CHAR(36)     NULL,
  is_private      BOOLEAN      NOT NULL DEFAULT FALSE,
  member_count    INT UNSIGNED NOT NULL DEFAULT 0,  -- kept in step with community_group_members
  created_by      VARCHAR(64)  NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_groups_slug (slug),
  KEY idx_groups_name (name),
  CONSTRAINT fk_groups_cover FOREIGN KEY (cover_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_groups_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS community_group_members (
  group_id   CHAR(36)    NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  role       ENUM('member', 'admin') NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),                  -- one membership per member and group
  KEY idx_group_members_user (user_id),
  CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES community_groups (id) ON DELETE CASCADE,
  CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Feed posts. group_id NULL = the main feed; otherwise the post belongs to that group.
-- Counts are kept in step by the server inside the same transaction as the like/comment.
CREATE TABLE IF NOT EXISTS community_posts (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  user_id        VARCHAR(64)   NOT NULL,
  group_id       CHAR(36)      NULL,
  category       ENUM('general', 'meal', 'progress', 'achievement') NOT NULL DEFAULT 'general',
  audience       ENUM('public', 'followers', 'only_me') NOT NULL DEFAULT 'public',  -- who may see it (group posts: the group)
  body           VARCHAR(1000) NOT NULL,
  media_id       CHAR(36)      NULL,
  like_count     INT UNSIGNED  NOT NULL DEFAULT 0,
  comment_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP     NULL,                -- soft delete, so reports keep their context
  PRIMARY KEY (id),
  KEY idx_posts_feed (deleted_at, created_at, id),  -- newest first, cursor on (created_at, id)
  KEY idx_posts_group (group_id, deleted_at, created_at),
  KEY idx_posts_user (user_id, created_at),
  CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_posts_group FOREIGN KEY (group_id) REFERENCES community_groups (id) ON DELETE CASCADE,
  CONSTRAINT fk_posts_media FOREIGN KEY (media_id) REFERENCES community_media (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS community_post_likes (
  post_id     CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),                   -- a member likes a post once
  CONSTRAINT fk_likes_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS community_comments (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  post_id     CHAR(36)     NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  body        VARCHAR(500) NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY idx_comments_post (post_id, deleted_at, created_at, id),   -- oldest first, cursor on (created_at, id)
  CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Stories: an image with an optional caption, gone after expires_at (24 h by default)
CREATE TABLE IF NOT EXISTS community_stories (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(64)  NOT NULL,
  media_id    CHAR(36)     NOT NULL,
  caption     VARCHAR(200) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP    NOT NULL,
  PRIMARY KEY (id),
  KEY idx_stories_active (expires_at, user_id, created_at),
  CONSTRAINT fk_stories_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_stories_media FOREIGN KEY (media_id) REFERENCES community_media (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS community_story_views (
  story_id   CHAR(36)    NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  viewed_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, user_id),                  -- a view is recorded once
  CONSTRAINT fk_story_views_story FOREIGN KEY (story_id) REFERENCES community_stories (id) ON DELETE CASCADE,
  CONSTRAINT fk_story_views_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- A member reporting a post or a comment, for an admin to review
CREATE TABLE IF NOT EXISTS community_reports (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  reporter_id  VARCHAR(64)  NOT NULL,
  post_id      CHAR(36)     NULL,
  comment_id   CHAR(36)     NULL,
  reason       VARCHAR(300) NOT NULL,
  status       ENUM('open', 'reviewed', 'dismissed') NOT NULL DEFAULT 'open',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reports_status (status, created_at),
  CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_post FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_comment FOREIGN KEY (comment_id) REFERENCES community_comments (id) ON DELETE CASCADE,
  CONSTRAINT chk_reports_target CHECK ((post_id IS NULL) <> (comment_id IS NULL))
) ENGINE = InnoDB;

-- Direct messages between two members. A member only ever sees conversations they are in.
CREATE TABLE IF NOT EXISTS conversations (
  id               CHAR(36)   NOT NULL DEFAULT (UUID()),
  created_at       TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at  TIMESTAMP(6) NULL,                 -- sub-second, so unread counts are exact
  PRIMARY KEY (id),
  KEY idx_conversations_recent (last_message_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id  CHAR(36)    NOT NULL,
  user_id          VARCHAR(64) NOT NULL,
  last_read_at     TIMESTAMP(6) NULL,               -- messages after this are unread (sub-second)
  PRIMARY KEY (conversation_id, user_id),
  KEY idx_conversation_members_user (user_id),
  CONSTRAINT fk_conv_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  conversation_id  CHAR(36)      NOT NULL,
  sender_id        VARCHAR(64)   NOT NULL,
  body             VARCHAR(1000) NOT NULL,
  created_at       TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_messages_conversation (conversation_id, created_at, id),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Community account settings: a private account shows its posts and stories to accepted
-- followers only; a suspended account's content is hidden from everyone but admins.
-- One row per member, created on first use (members without a row are public and active).
CREATE TABLE IF NOT EXISTS community_profiles (
  user_id     VARCHAR(64)  NOT NULL,
  is_private  BOOLEAN      NOT NULL DEFAULT FALSE,
  status      ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  bio         VARCHAR(160) NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_cprofiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- follower_id follows following_id. Following a public account is accepted at once; a
-- private account's owner accepts or declines the request.
CREATE TABLE IF NOT EXISTS community_follows (
  follower_id   VARCHAR(64) NOT NULL,
  following_id  VARCHAR(64) NOT NULL,
  status        ENUM('pending', 'accepted') NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, following_id),
  KEY idx_follows_following (following_id, status),
  CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_follows_following FOREIGN KEY (following_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_follows_self CHECK (follower_id <> following_id)
) ENGINE = InnoDB;

-- blocker_id can't see blocked_id's content and vice versa
CREATE TABLE IF NOT EXISTS community_blocks (
  blocker_id  VARCHAR(64) NOT NULL,
  blocked_id  VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY idx_blocks_blocked (blocked_id),
  CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_blocks_self CHECK (blocker_id <> blocked_id)
) ENGINE = InnoDB;

-- Starting groups (public; member counts grow as members join)
INSERT IGNORE INTO community_groups (slug, name, topic, description) VALUES
  ('healthy-eating', 'Healthy Eating', 'Healthy eating', 'Everyday habits, balanced plates and recipe swaps that stick.'),
  ('fat-loss', 'Fat Loss', 'Fat loss', 'Sustainable deficits, weekly check-ins and staying full on fewer calories.'),
  ('muscle-gain', 'Muscle Gain', 'Muscle gain', 'Training splits, progressive overload and eating enough to grow.'),
  ('high-protein-meals', 'High-Protein Meals', 'High protein', 'Meal ideas and justFit orders that hit your protein target.'),
  ('meal-prep', 'Meal Prep', 'Meal preparation', 'Batch cooking, storage tips and weekly prep routines.');
