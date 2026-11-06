-- Enquiry contacts (approved by the user on 2026-11-06, for the enquiry-conversion prediction):
-- one row per contact attempt with an enquiry, so Manage › Enquiry can score "called back within
-- 2 days" and "no answer twice". kind: call, whatsapp or visit; outcome: reached, no_answer or
-- visited (a visit is always visited). Nothing in gym_enquiries changes.
--
-- Safe to run more than once: CREATE TABLE IF NOT EXISTS, nothing is deleted. Run after
-- 2026-11-29-gym-staff-logins.sql, by hand, with an account allowed to create tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-30-gym-enquiry-contacts.sql

CREATE TABLE IF NOT EXISTS gym_enquiry_contacts (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id        INT UNSIGNED NOT NULL,
  enquiry_id    INT UNSIGNED NOT NULL,
  kind          ENUM('call', 'whatsapp', 'visit') NOT NULL,
  outcome       ENUM('reached', 'no_answer', 'visited') NOT NULL,
  contacted_on  DATE         NOT NULL,             -- India's date
  created_by    VARCHAR(64)  NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_enquiry_contacts_enquiry (enquiry_id, contacted_on),
  CONSTRAINT fk_gym_enquiry_contacts_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_enquiry_contacts_enquiry FOREIGN KEY (enquiry_id) REFERENCES gym_enquiries (id),
  CONSTRAINT fk_gym_enquiry_contacts_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
