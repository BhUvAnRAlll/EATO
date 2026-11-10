-- Body scans kept (2026-11-10, the user's request): every body scan's two photos and its report
-- are kept, so the Super Admin can see them (Super Admin › Body scans, and a member's page), and
-- the member can see and delete their own (Profile › My body scans). Until now the photos were
-- read in memory and thrown away; the scan screens and the Privacy Policy now say they are kept.
-- The photo files live on the server's disk in BODY_SCAN_DIR (default uploads/body-scans,
-- git-ignored); a row keeps only their random names. Removed with the account.
--
-- Adds one table; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-25-body-scans.sql

CREATE TABLE IF NOT EXISTS body_scans (
  id                CHAR(36)      NOT NULL,
  user_id           VARCHAR(64)   NOT NULL,
  front_key         VARCHAR(80)   NOT NULL,             -- the photo files' names (made by the server)
  side_key          VARCHAR(80)   NOT NULL,
  sex               ENUM('male', 'female') NOT NULL,      -- what the scan was given
  age               TINYINT UNSIGNED NOT NULL,
  height_cm         DECIMAL(5,1)  NOT NULL,
  weight_kg         DECIMAL(5,1)  NOT NULL,
  body_fat_percent  DECIMAL(4,1)  NOT NULL,             -- the estimate
  report            JSON          NOT NULL,             -- the full report the member saw
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_body_scans_user (user_id, created_at),
  KEY idx_body_scans_created (created_at),
  CONSTRAINT fk_body_scans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
