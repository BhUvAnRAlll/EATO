-- Gym Hub › Book a free trial (2026-11-10, the user's request): a member asks a gym for a trial
-- visit from the gym's page, with a few details (name, age, gender, goal, experience) and a
-- preferred day and time of day. It is an enquiry (interest 'trial', source 'app'); the gym
-- schedules it for a date and time and marks it done or no-show. Before this runs, booking a trial
-- and scheduling one answer 503 naming this file. No new table.
--
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-02-02-gym-trials.sql

ALTER TABLE gym_enquiries
  ADD COLUMN trial_details JSON NULL AFTER plan_label,
  ADD COLUMN trial_status ENUM('requested', 'scheduled', 'done', 'no_show', 'cancelled') NULL AFTER trial_details,
  ADD COLUMN trial_at DATETIME NULL AFTER trial_status;
