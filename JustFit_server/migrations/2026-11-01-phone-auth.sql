-- Phone sign-in (Clerk → OTP over SMS, approved 2026-10-28). Adds to an existing database; no
-- row is changed or deleted, user ids keep their format, and every foreign key to users(id)
-- stays as it is. schema.sql already has all of this for a fresh install.
--   1. users.email becomes optional (phone-only accounts have none; uq_users_email stays and
--      NULLs don't collide).
--   2. users.phone_verified_at + the virtual users.verified_phone with a unique key: only a
--      phone confirmed by a code signs anyone in, at most one account per verified phone.
--      Phones typed during setup before this change stay unverified and are left alone.
--   3. otp_challenges: one row per code sent (only an HMAC of the code is stored).
--   4. auth_sessions: one row per signed-in device (only a SHA-256 of the token is stored).
-- Safe to run more than once: each step checks first. Run after 2026-10-31-coach-plans.sql,
-- by hand, with an account allowed to alter and create tables (eato_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p eato < migrations/2026-11-01-phone-auth.sql
-- Back up the database first. To undo (development only), in this order:
--   DROP TABLE IF EXISTS auth_sessions, otp_challenges;
--   ALTER TABLE users DROP CHECK chk_users_phone_verified, DROP INDEX uq_users_verified_phone,
--     DROP COLUMN verified_phone, DROP COLUMN phone_verified_at;
--   ALTER TABLE users MODIFY email VARCHAR(255) NOT NULL;   -- only while no row has a NULL email
-- The last step fails (and changes nothing) once a phone-only account exists: those rows need an
-- email or must be removed first, which is a data decision, not part of this file.
-- Times: expires_at and the other DATETIME columns are always written and compared in SQL
-- (NOW() + INTERVAL ...), never from JavaScript dates, so they follow the database clock.

-- 1. Email optional (re-running this is harmless)
ALTER TABLE users MODIFY email VARCHAR(255) NULL;

-- 2. The verified phone (MySQL has no ADD COLUMN IF NOT EXISTS, so the column is checked first)
SET @has_verified_at := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_verified_at'
);
SET @add_verified_phone := IF(
  @has_verified_at = 0,
  'ALTER TABLE users
     ADD COLUMN phone_verified_at DATETIME NULL AFTER phone,
     ADD COLUMN verified_phone CHAR(10) AS (IF(phone_verified_at IS NULL, NULL, phone)) VIRTUAL AFTER phone_verified_at,
     ADD UNIQUE KEY uq_users_verified_phone (verified_phone),
     ADD CONSTRAINT chk_users_phone_verified CHECK (phone_verified_at IS NULL OR phone IS NOT NULL)',
  'SELECT 1'
);
PREPARE add_verified_phone FROM @add_verified_phone;
EXECUTE add_verified_phone;
DEALLOCATE PREPARE add_verified_phone;

-- 3. Codes sent by SMS. No foreign key: a code can be for a number that has no account yet.
-- The server writes the id itself (the HMAC covers it) and keeps every row; old rows only
-- count towards the send limits.
CREATE TABLE IF NOT EXISTS otp_challenges (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  phone        CHAR(10)          NOT NULL,                     -- 10 digits, +91 implied
  code_hash    CHAR(64)          NOT NULL,                     -- HMAC-SHA256 of "<id>:<code>", hex
  status       ENUM('pending', 'sent', 'failed', 'consumed', 'superseded', 'locked') NOT NULL DEFAULT 'pending',
  attempts     TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  expires_at   DATETIME          NOT NULL,
  consumed_at  DATETIME          NULL,
  created_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),  -- milliseconds: "the latest code" is unambiguous
  PRIMARY KEY (id),
  KEY idx_otp_phone_created (phone, created_at),
  KEY idx_otp_created (created_at),                            -- the daily SMS cap
  CONSTRAINT chk_otp_phone CHECK (phone REGEXP '^[6-9][0-9]{9}$'),
  CONSTRAINT chk_otp_code_hash CHECK (code_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_otp_attempts CHECK (attempts <= 10)
) ENGINE = InnoDB;

-- 4. Signed-in devices. Only user_id cascades (one level, from users: see the cascade note).
CREATE TABLE IF NOT EXISTS auth_sessions (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id       VARCHAR(64)  NOT NULL,
  token_hash    CHAR(64)     NOT NULL,                         -- SHA-256 of the bearer token, hex
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME     NULL,                             -- refreshed at most once an hour
  expires_at    DATETIME     NOT NULL,                         -- absolute: 30 days after sign-in
  revoked_at    DATETIME     NULL,                             -- logout, logout everywhere
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_token (token_hash),
  KEY idx_auth_sessions_user (user_id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_auth_sessions_token CHECK (token_hash REGEXP '^[0-9a-f]{64}$')
) ENGINE = InnoDB;
