-- The in-app gym assistant is on by default: a gym's agent starts in "testing" (members can ask
-- in the app; WhatsApp replies only once the owner makes it "active"). Changes the column default
-- and moves gyms still on the old default from "disabled" to "testing". Safe to run more than
-- once. Needs 2026-10-24-whatsapp-agent.sql first. Run by hand, e.g.:
--   mysql -u root -p justfit < migrations/2026-10-25-assistant-default.sql

ALTER TABLE whatsapp_agent_settings
  MODIFY agent_status ENUM('disabled', 'testing', 'active') NOT NULL DEFAULT 'testing';

-- Only rows nobody has changed yet (no owner screen could switch the agent before this)
UPDATE whatsapp_agent_settings SET agent_status = 'testing' WHERE agent_status = 'disabled' AND updated_by IS NULL;
