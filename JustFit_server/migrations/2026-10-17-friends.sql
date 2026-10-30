-- Community friendships (Add Friend): one row per pair of members, separate from follows.
-- Adds one table to an existing database; safe to run more than once. schema.sql has the
-- same definition for a fresh install. Run by hand after 2026-10-16-stories.sql, e.g.:
--   mysql -u root -p eato < migrations/2026-10-17-friends.sql
--
-- user_low / user_high are the two members in a fixed order, so the primary key allows one
-- row per pair whichever side asks first. requester_id is who sent the current request.
-- Every change is an UPDATE of status (never a DELETE), so the history stays.
CREATE TABLE IF NOT EXISTS community_friendships (
  user_low      VARCHAR(64) NOT NULL,
  user_high     VARCHAR(64) NOT NULL,
  requester_id  VARCHAR(64) NOT NULL,
  status        ENUM('pending', 'accepted', 'declined', 'cancelled', 'removed') NOT NULL DEFAULT 'pending',
  requested_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at  TIMESTAMP   NULL,
  updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_low, user_high),
  KEY idx_friendships_high (user_high, status),
  KEY idx_friendships_requester (requester_id, status),
  CONSTRAINT fk_friendships_low FOREIGN KEY (user_low) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_high FOREIGN KEY (user_high) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_friendships_order CHECK (user_low < user_high),
  CONSTRAINT chk_friendships_requester CHECK (requester_id = user_low OR requester_id = user_high)
) ENGINE = InnoDB;
