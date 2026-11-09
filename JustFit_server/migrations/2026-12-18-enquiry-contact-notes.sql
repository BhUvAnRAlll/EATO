-- Enquiry contact notes (approved by the user on 2026-11-09): what the person said when a contact
-- was logged ("Coming Saturday with a friend"), up to 300 characters, optional. Older contacts keep
-- NULL. Nothing else changes; the next follow-up date picked with the log is written to
-- gym_enquiries.follow_up_on, which already exists.
--
-- Run after 2026-11-30-gym-enquiry-contacts.sql, by hand, with an account allowed to alter tables:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-18-enquiry-contact-notes.sql
-- Running it twice fails with "Duplicate column name 'note'", which is harmless.

ALTER TABLE gym_enquiry_contacts
  ADD COLUMN note VARCHAR(300) NULL AFTER outcome;
