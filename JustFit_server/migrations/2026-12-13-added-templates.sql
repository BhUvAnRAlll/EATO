-- Added templates (asked for by the user on 2026-11-08): beside the four reminder messages a branch
-- can reword, the gym admin can add messages of their own (a name and the text with its
-- {placeholders}), listed in Send Reminder's Use Template. Up to 20 a branch (checked by the
-- server); names are unique within a branch. In order:
--   1. gym_added_templates
--
-- Like the four, they go out from the phone's own WhatsApp or Messages app: justFit's own SMS keep
-- their DLT-registered texts.
--
-- Safe to run more than once: it checks first, and nothing is deleted. Before it runs, Reminder
-- Templates shows no Add button and adding answers that this migration is needed. Run after
-- 2026-12-12-member-plan-name.sql, by hand, with an account allowed to create tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-13-added-templates.sql

-- 1. The templates
CREATE TABLE IF NOT EXISTS gym_added_templates (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,                -- the branch
  name        VARCHAR(40)  NOT NULL,                -- shown on Use Template
  body        VARCHAR(300) NOT NULL,                -- the text with its {placeholders}
  updated_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_added_templates_name (gym_id, name),
  CONSTRAINT fk_gym_added_templates_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_added_templates_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
