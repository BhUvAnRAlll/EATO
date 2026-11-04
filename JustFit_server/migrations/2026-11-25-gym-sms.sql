-- Send Bulk SMS (asked for by the user on 2026-11-04, from the GymOps designs): each branch has SMS
-- credits (1 credit = 1 SMS, added by the justFit team in Super Admin › Gyms), Auto Reminders it
-- can switch on (expiry, expired, due, birthday) and a log of every SMS sent to a member. In order:
--   1. gyms gets sms_credits (every branch starts at 0)
--   2. gym_sms_settings: the switches (no row = off)
--   3. gym_sms_log: Message Logs, and the once-only key of each auto reminder
--
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-24-catalog-stock.sql, by hand, with an account allowed to alter tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-25-gym-sms.sql

-- 1. Credits
SET @has_credits := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'sms_credits');
SET @sql := IF(@has_credits = 0, 'ALTER TABLE gyms ADD COLUMN sms_credits INT UNSIGNED NOT NULL DEFAULT 0 AFTER next_member_no', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2 and 3. The switches and the log
-- Send Bulk SMS (gym/sms.js): which auto reminders a branch has switched on (no row = off)
CREATE TABLE IF NOT EXISTS gym_sms_settings (
  gym_id      INT UNSIGNED NOT NULL,
  kind        ENUM('expiry', 'expired', 'due', 'birthday') NOT NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 0,
  updated_by  VARCHAR(64)  NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id, kind),
  CONSTRAINT fk_gym_sms_settings_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_sms_settings_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Every SMS sent to a member (Message Logs): what it said, how it went, the credit it cost
-- (0 once refunded after a failure). auto_key makes each auto reminder go once per member
-- ("expiry:2026-11-30", "due:2026-11-02", "birthday:2026"); manual sends have none.
CREATE TABLE IF NOT EXISTS gym_sms_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,
  member_id   INT UNSIGNED NOT NULL,
  kind        ENUM('expiry', 'expired', 'due', 'birthday') NOT NULL,
  source      ENUM('auto', 'manual') NOT NULL,
  status      ENUM('sending', 'sent', 'failed') NOT NULL,
  body        VARCHAR(320) NOT NULL,
  credits     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  auto_key    VARCHAR(40)  NULL,
  error       VARCHAR(40)  NULL,                    -- the provider's status code only
  sent_by     VARCHAR(64)  NULL,                    -- the gym admin (NULL for auto reminders)
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_sms_auto (member_id, auto_key),
  KEY idx_gym_sms_log_gym (gym_id, id),
  CONSTRAINT fk_gym_sms_log_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_sms_log_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_gym_sms_log_by FOREIGN KEY (sent_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
