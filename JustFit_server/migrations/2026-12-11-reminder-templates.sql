-- Reminder Templates (asked for by the user on 2026-11-08): each branch's own wording for the
-- messages Send Reminder and the enquiry WhatsApp button write (payment due, membership expiring,
-- membership expired, enquiry follow-up). A branch without a row uses justFit's default text, so
-- nothing changes until the gym admin edits one. In order:
--   1. gym_reminder_templates, one row per branch and kind
--
-- The text keeps its placeholders ({name}, {gym}, {amount}…); the app fills them in for each
-- member. SMS sent through justFit still use the DLT-registered texts in gym/smsRules.js, never
-- these: a custom template goes from the phone's own WhatsApp or Messages app.
--
-- Safe to run more than once: it checks first, and nothing is deleted. Before it runs, Reminder
-- Templates says this migration is needed and every reminder uses the default text. Run after
-- 2026-12-10-gym-expenses.sql, by hand, with an account allowed to create tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-11-reminder-templates.sql

-- 1. The templates
CREATE TABLE IF NOT EXISTS gym_reminder_templates (
  gym_id      INT UNSIGNED NOT NULL,                -- the branch
  kind        ENUM('due', 'expiry', 'expired', 'enquiry') NOT NULL,
  body        VARCHAR(300) NOT NULL,                -- the text with its {placeholders}
  updated_by  VARCHAR(64)  NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id, kind),
  CONSTRAINT fk_gym_reminder_templates_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_reminder_templates_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
