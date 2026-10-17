-- Gym communities: gyms, their members, invitations, announcements, events and RSVPs, and
-- gym posts (community_posts gains gym_id and review_status). Adds to an existing database;
-- safe to run more than once. schema.sql already has all of this for a fresh install. Needs
-- 2026-10-14-community.sql first (gyms reference community_media). Run by hand with an
-- account allowed to create and alter tables (the app's eato_app account can't), e.g.:
--   mysql -u root -p eato < migrations/2026-10-20-gyms.sql

CREATE TABLE IF NOT EXISTS gyms (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  name                   VARCHAR(80)   NOT NULL,
  tagline                VARCHAR(120)  NULL,
  description            VARCHAR(1000) NULL,
  location               VARCHAR(80)   NULL,            -- the area, e.g. "Indiranagar, Bengaluru"
  address                VARCHAR(200)  NULL,
  logo_media_id          CHAR(36)      NULL,
  cover_media_id         CHAR(36)      NULL,
  hours                  JSON          NULL,            -- [{ label, value }]
  facilities             JSON          NULL,            -- ["Free weights", ...]
  membership_tiers       JSON          NULL,            -- [{ name, price, perks }]
  guidelines             JSON          NULL,            -- ["Re-rack your weights", ...]
  contact_phone          VARCHAR(20)   NULL,
  contact_email          VARCHAR(120)  NULL,
  contact_website        VARCHAR(200)  NULL,
  invite_code            CHAR(8)       NOT NULL,        -- joins as a member (an invitation, so no approval)
  visibility             ENUM('public', 'private', 'hidden') NOT NULL DEFAULT 'public',
  who_can_post           ENUM('everyone', 'trainers', 'admins') NOT NULL DEFAULT 'everyone',
  who_can_comment        ENUM('members', 'trainers', 'off') NOT NULL DEFAULT 'members',
  who_can_create_events  ENUM('admins', 'trainers', 'members') NOT NULL DEFAULT 'trainers',
  member_approval        BOOLEAN       NOT NULL DEFAULT FALSE,
  post_moderation        BOOLEAN       NOT NULL DEFAULT FALSE,
  plan                   ENUM('starter', 'pro', 'elite') NOT NULL DEFAULT 'starter',
  member_count           INT UNSIGNED  NOT NULL DEFAULT 0,  -- active members, kept in step by the server
  created_by             VARCHAR(64)   NULL,            -- the platform admin who created it
  created_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gyms_name (name),
  UNIQUE KEY uq_gyms_invite_code (invite_code),
  KEY idx_gyms_visibility (visibility, name),
  CONSTRAINT fk_gyms_logo FOREIGN KEY (logo_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_gyms_cover FOREIGN KEY (cover_media_id) REFERENCES community_media (id) ON DELETE SET NULL,
  CONSTRAINT fk_gyms_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- community_posts.gym_id and review_status (MySQL has no ADD COLUMN IF NOT EXISTS, so the
-- column is checked first). A gym is never hard-deleted, hence ON DELETE RESTRICT.
SET @has_gym_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'gym_id'
);
SET @add_gym_id := IF(
  @has_gym_id = 0,
  'ALTER TABLE community_posts ADD COLUMN gym_id CHAR(36) NULL AFTER group_id, ADD COLUMN review_status ENUM(''published'', ''pending'') NOT NULL DEFAULT ''published'' AFTER gym_id, ADD KEY idx_posts_gym (gym_id, deleted_at, created_at), ADD CONSTRAINT fk_posts_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE add_gym_id FROM @add_gym_id;
EXECUTE add_gym_id;
DEALLOCATE PREPARE add_gym_id;

CREATE TABLE IF NOT EXISTS gym_members (
  gym_id        CHAR(36)    NOT NULL,
  user_id       VARCHAR(64) NOT NULL,
  role          ENUM('owner', 'admin', 'trainer', 'member') NOT NULL DEFAULT 'member',
  status        ENUM('active', 'pending', 'suspended') NOT NULL DEFAULT 'active',
  requested_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  joined_at     TIMESTAMP   NULL,                     -- when the membership became active
  owner_gym     CHAR(36)    AS (IF(role = 'owner', gym_id, NULL)) VIRTUAL,
  PRIMARY KEY (gym_id, user_id),
  UNIQUE KEY uq_gym_members_one_owner (owner_gym),
  KEY idx_gym_members_user (user_id, status),
  KEY idx_gym_members_gym_status (gym_id, status, role),
  CONSTRAINT fk_gym_members_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_invitations (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id       CHAR(36)     NOT NULL,
  code         CHAR(10)     NOT NULL,
  channel      ENUM('link', 'qr', 'email', 'phone') NOT NULL,
  contact      VARCHAR(120) NULL,                    -- the email or phone it was meant for
  role         ENUM('member', 'trainer') NOT NULL DEFAULT 'member',
  status       ENUM('pending', 'accepted', 'revoked') NOT NULL DEFAULT 'pending',
  invited_by   VARCHAR(64)  NULL,
  accepted_by  VARCHAR(64)  NULL,
  expires_at   TIMESTAMP    NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_invitations_code (code),
  KEY idx_gym_invitations_gym (gym_id, status, created_at),
  CONSTRAINT fk_gym_invitations_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_invitations_inviter FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_invitations_accepter FOREIGN KEY (accepted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_announcements (
  id          CHAR(36)      NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)      NOT NULL,
  author_id   VARCHAR(64)   NULL,
  title       VARCHAR(120)  NOT NULL,
  body        VARCHAR(1000) NOT NULL,
  pinned      BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_announcements_gym (gym_id, pinned, updated_at),
  CONSTRAINT fk_gym_announcements_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_announcements_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_events (
  id              CHAR(36)          NOT NULL DEFAULT (UUID()),
  gym_id          CHAR(36)          NOT NULL,
  host_id         VARCHAR(64)       NULL,
  title           VARCHAR(80)       NOT NULL,
  description     VARCHAR(1000)     NOT NULL,
  event_date      DATE              NOT NULL,
  start_time      TIME              NOT NULL,
  end_time        TIME              NOT NULL,
  location        VARCHAR(120)      NOT NULL,
  max_attendees   SMALLINT UNSIGNED NULL,          -- NULL = no limit
  attendee_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_events_gym_date (gym_id, event_date, start_time),
  CONSTRAINT fk_gym_events_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_events_host FOREIGN KEY (host_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_events_times CHECK (end_time > start_time),
  CONSTRAINT chk_gym_events_capacity CHECK (max_attendees IS NULL OR max_attendees >= 1)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gym_event_rsvps (
  event_id    CHAR(36)    NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  KEY idx_gym_event_rsvps_user (user_id),
  CONSTRAINT fk_gym_event_rsvps_event FOREIGN KEY (event_id) REFERENCES gym_events (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_event_rsvps_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
