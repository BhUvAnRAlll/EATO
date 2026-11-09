-- Gym Hub ecosystem, phase 1 (the user's brief of 2026-11-09): gyms register themselves from the
-- member app and wait for the Super Admin's approval. A branch has a status (draft, submitted,
-- pending_review, approved, rejected, suspended); members discover only approved, published ones,
-- and a suspended branch is closed to its portal and to check-ins. The application's business
-- details live on the gym (gym_brands), its documents in gym_documents (files on the server's
-- disk, read only by the applicant and the Super Admin) and every step in gym_status_history.
--
-- Every gym already on justFit is approved by this migration, so nothing disappears. Nothing is
-- deleted. Safe to run more than once. Run by hand, from JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-27-gym-registration.sql

-- 1. The business behind the gym, as the applicant gave it (all optional until submitted)
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_brands' AND COLUMN_NAME = 'applicant_id');
SET @sql := IF(@has = 0, 'ALTER TABLE gym_brands
  ADD COLUMN legal_name VARCHAR(120) NULL AFTER name,
  ADD COLUMN business_type ENUM(''individual'', ''partnership'', ''private_limited'', ''llp'', ''other'') NULL AFTER legal_name,
  ADD COLUMN contact_name VARCHAR(80) NULL AFTER business_type,
  ADD COLUMN contact_phone CHAR(10) NULL AFTER contact_name,
  ADD COLUMN contact_email VARCHAR(120) NULL AFTER contact_phone,
  ADD COLUMN applicant_id VARCHAR(64) NULL AFTER contact_email', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The branch's place and approval state; existing branches are approved by the default
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'status');
SET @sql := IF(@has = 0, 'ALTER TABLE gyms
  ADD COLUMN state VARCHAR(40) NULL AFTER city,
  ADD COLUMN pincode CHAR(6) NULL AFTER state,
  ADD COLUMN status ENUM(''draft'', ''submitted'', ''pending_review'', ''approved'', ''rejected'', ''suspended'') NOT NULL DEFAULT ''approved'' AFTER pincode,
  ADD COLUMN status_note VARCHAR(300) NULL AFTER status,
  ADD COLUMN status_changed_at TIMESTAMP NULL AFTER status_note,
  ADD COLUMN submitted_at TIMESTAMP NULL AFTER status_changed_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_brands' AND CONSTRAINT_NAME = 'fk_gym_brands_applicant');
SET @sql := IF(@fk = 0, 'ALTER TABLE gym_brands ADD CONSTRAINT fk_gym_brands_applicant FOREIGN KEY (applicant_id) REFERENCES users (id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ix := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND INDEX_NAME = 'idx_gyms_status');
SET @sql := IF(@ix = 0, 'ALTER TABLE gyms ADD KEY idx_gyms_status (status, id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Documents sent with an application: private files, never shown to members
CREATE TABLE IF NOT EXISTS gym_documents (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id       INT UNSIGNED NOT NULL,                  -- the branch applied for
  kind         ENUM('registration', 'address', 'other') NOT NULL,
  file_key     VARCHAR(64)  NOT NULL,                  -- the file's random name in GYM_DOCUMENT_DIR
  media_type   ENUM('image/jpeg', 'image/png', 'image/webp', 'application/pdf') NOT NULL,
  bytes        INT UNSIGNED NOT NULL,
  uploaded_by  VARCHAR(64)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_documents_file (file_key),
  KEY idx_gym_documents_gym (gym_id, id),
  CONSTRAINT fk_gym_documents_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_documents_by FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Every step of a branch's approval: who did what, from which state to which, and why
CREATE TABLE IF NOT EXISTS gym_status_history (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id       INT UNSIGNED NOT NULL,
  action       ENUM('create', 'submit', 'start_review', 'approve', 'reject', 'request_documents', 'request_changes', 'suspend', 'reactivate') NOT NULL,
  from_status  ENUM('draft', 'submitted', 'pending_review', 'approved', 'rejected', 'suspended') NULL,
  to_status    ENUM('draft', 'submitted', 'pending_review', 'approved', 'rejected', 'suspended') NOT NULL,
  note         VARCHAR(300) NULL,                      -- the reason or the request, as written
  by_user      VARCHAR(64)  NULL,
  by_admin     TINYINT(1)   NOT NULL DEFAULT 0,        -- 1: a justFit admin; 0: the applicant
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_gym_status_history_gym (gym_id, id),
  CONSTRAINT fk_gym_status_history_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_status_history_by FOREIGN KEY (by_user) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
