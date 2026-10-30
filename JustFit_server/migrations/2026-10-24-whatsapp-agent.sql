-- WhatsApp gym agent: membership plan records, each gym's WhatsApp connection and agent
-- settings, FAQs, customer conversations and messages, webhook events, a small job queue,
-- message templates, campaigns, usage, a pricing table and an audit log. Adds to an existing
-- database; safe to run more than once. schema.sql has all of this for a fresh install. Needs
-- 2026-10-23-drop-groups.sql first. Run by hand with an account allowed to create tables
-- (justfit_app can't), e.g.:
--   mysql -u root -p justfit < migrations/2026-10-24-whatsapp-agent.sql
--
-- Gyms are never hard-deleted, so gym-owned rows use ON DELETE RESTRICT. Only a member's own
-- rows cascade, one level below users (a three-level chain orphans rows on MySQL 9.7). Ids that
-- point within the agent's tables (a message's conversation, a recipient's message) are checked
-- by the server rather than cascaded, for the same reason.

-- A member's plan at a gym, set by gym staff: the one record the agent reads for package status
CREATE TABLE IF NOT EXISTS gym_member_plans (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)     NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  plan_name   VARCHAR(80)  NOT NULL,
  price_label VARCHAR(40)  NULL,
  status      ENUM('active', 'paused', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
  starts_on   DATE         NOT NULL,
  ends_on     DATE         NULL,
  created_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_member_plans_member (gym_id, user_id, status, ends_on),
  KEY idx_member_plans_user (user_id),
  CONSTRAINT fk_member_plans_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_member_plans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_member_plans_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
) ENGINE = InnoDB;

-- One per gym: the WhatsApp Business number it connected. The access token is encrypted with
-- AES-256-GCM (WHATSAPP_TOKEN_KEY) and never leaves the server.
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  gym_id             CHAR(36)      NOT NULL,
  status             ENUM('disconnected', 'pending', 'connected', 'error') NOT NULL DEFAULT 'disconnected',
  waba_id            VARCHAR(32)   NULL,              -- WhatsApp Business Account id
  phone_number_id    VARCHAR(32)   NULL,              -- the id Meta's webhooks name; routes every message
  display_phone      VARCHAR(32)   NULL,
  token_ciphertext   VARBINARY(2048) NULL,
  token_iv           VARBINARY(12) NULL,
  token_tag          VARBINARY(16) NULL,
  token_expires_at   TIMESTAMP     NULL,              -- NULL: a token that doesn't expire
  webhook_subscribed BOOLEAN       NOT NULL DEFAULT FALSE,
  disabled_by_admin  BOOLEAN       NOT NULL DEFAULT FALSE,
  last_health_at     TIMESTAMP     NULL,
  last_error         VARCHAR(300)  NULL,              -- a safe summary, never a token or payload
  connected_by       VARCHAR(64)   NULL,
  connected_at       TIMESTAMP     NULL,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id),
  UNIQUE KEY uq_whatsapp_phone_number (phone_number_id),
  CONSTRAINT fk_whatsapp_connections_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_connections_by FOREIGN KEY (connected_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One per gym: whether the agent replies, and the owner's extra instructions
CREATE TABLE IF NOT EXISTS whatsapp_agent_settings (
  gym_id             CHAR(36)      NOT NULL,
  agent_status       ENUM('disabled', 'testing', 'active') NOT NULL DEFAULT 'disabled',
  instructions       VARCHAR(2000) NULL,
  escalation_contact VARCHAR(120)  NULL,
  daily_reply_limit  INT UNSIGNED  NOT NULL DEFAULT 500,
  updated_by         VARCHAR(64)   NULL,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (gym_id),
  CONSTRAINT fk_agent_settings_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_agent_settings_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_agent_reply_limit CHECK (daily_reply_limit BETWEEN 1 AND 10000)
) ENGINE = InnoDB;

-- Questions and answers the gym approved, used by the WhatsApp agent and the in-app assistant
CREATE TABLE IF NOT EXISTS gym_faqs (
  id         CHAR(36)         NOT NULL DEFAULT (UUID()),
  gym_id     CHAR(36)         NOT NULL,
  question   VARCHAR(200)     NOT NULL,
  answer     VARCHAR(1000)    NOT NULL,
  position   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active     BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_faqs_gym (gym_id, active, position),
  CONSTRAINT fk_gym_faqs_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- A WhatsApp number that wrote to (or opted in with) a gym. linked_user_id is set only after
-- the member proves both the justFit account and the number (whatsapp_link_codes).
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id             CHAR(36)     NOT NULL,
  wa_id              VARCHAR(20)  NOT NULL,             -- digits only, as Meta sends it
  profile_name       VARCHAR(120) NULL,
  linked_user_id     VARCHAR(64)  NULL,
  linked_at          TIMESTAMP    NULL,
  marketing_opt_in   BOOLEAN      NOT NULL DEFAULT FALSE,
  consent_source     VARCHAR(60)  NULL,
  consent_at         TIMESTAMP    NULL,
  opted_out_at       TIMESTAMP    NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_contacts_number (gym_id, wa_id),
  KEY idx_whatsapp_contacts_user (linked_user_id),
  CONSTRAINT fk_whatsapp_contacts_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_contacts_user FOREIGN KEY (linked_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One conversation per contact per gym
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id           CHAR(36)     NOT NULL,
  contact_id       CHAR(36)     NOT NULL,
  handler          ENUM('ai', 'human') NOT NULL DEFAULT 'ai',
  ai_paused        BOOLEAN      NOT NULL DEFAULT FALSE,
  status           ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
  unread_count     INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at  TIMESTAMP    NULL,
  last_inbound_at  TIMESTAMP    NULL,                   -- opens WhatsApp's 24-hour reply window
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_conversations_contact (gym_id, contact_id),
  KEY idx_whatsapp_conversations_inbox (gym_id, status, last_message_at),
  CONSTRAINT fk_whatsapp_conversations_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Media (images) received or sent; served only through the server to the gym's staff
CREATE TABLE IF NOT EXISTS whatsapp_media (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id            CHAR(36)     NOT NULL,
  provider_media_id VARCHAR(128) NULL,
  mime_type         VARCHAR(60)  NULL,
  size_bytes        INT UNSIGNED NULL,
  sha256            CHAR(64)     NULL,
  storage_name      VARCHAR(80)  NULL,                  -- file name under the upload folder, never a path from Meta
  status            ENUM('pending', 'stored', 'unavailable', 'unsupported') NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_whatsapp_media_gym (gym_id, created_at),
  CONSTRAINT fk_whatsapp_media_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Every message in or out. provider_message_id is unique, so a repeated webhook can't store twice.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id              CHAR(36)     NOT NULL,
  conversation_id     CHAR(36)     NOT NULL,
  direction           ENUM('in', 'out') NOT NULL,
  sender              ENUM('customer', 'ai', 'staff', 'campaign', 'system') NOT NULL,
  staff_user_id       VARCHAR(64)  NULL,
  type                ENUM('text', 'image', 'template', 'other') NOT NULL DEFAULT 'text',
  body                TEXT         NULL,
  media_id            CHAR(36)     NULL,
  provider_message_id VARCHAR(128) NULL,
  status              ENUM('received', 'queued', 'sent', 'delivered', 'read', 'failed') NOT NULL,
  error_code          VARCHAR(40)  NULL,
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  status_at           TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_messages_provider (provider_message_id),
  KEY idx_whatsapp_messages_conversation (gym_id, conversation_id, created_at),
  CONSTRAINT fk_whatsapp_messages_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_messages_staff FOREIGN KEY (staff_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One-time codes that link a WhatsApp number to a signed-in member. Only a hash is stored.
CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
  id         CHAR(36)    NOT NULL DEFAULT (UUID()),
  gym_id     CHAR(36)    NOT NULL,
  user_id    VARCHAR(64) NOT NULL,
  code_hash  CHAR(64)    NOT NULL,
  attempts   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at TIMESTAMP   NOT NULL,
  used_at    TIMESTAMP   NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_link_codes_hash (gym_id, code_hash),
  KEY idx_whatsapp_link_codes_user (user_id, created_at),
  CONSTRAINT fk_whatsapp_link_codes_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_link_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Each webhook event once (event_key), saved before it's processed; purged after 30 days
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  event_key       VARCHAR(160) NOT NULL,
  phone_number_id VARCHAR(32)  NULL,
  gym_id          CHAR(36)     NULL,                    -- resolved by the server from phone_number_id
  kind            ENUM('message', 'status', 'other') NOT NULL,
  payload         JSON         NOT NULL,
  status          ENUM('pending', 'processed', 'ignored', 'failed', 'quarantined') NOT NULL DEFAULT 'pending',
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error      VARCHAR(300) NULL,
  received_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at    TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_webhook_events_key (event_key),
  KEY idx_whatsapp_webhook_events_status (status, received_at),
  CONSTRAINT fk_whatsapp_webhook_events_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- A small durable job queue polled by the server's worker
CREATE TABLE IF NOT EXISTS jobs (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  kind            VARCHAR(40)  NOT NULL,
  gym_id          CHAR(36)     NULL,
  payload         JSON         NOT NULL,
  status          ENUM('queued', 'running', 'done', 'failed') NOT NULL DEFAULT 'queued',
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts    TINYINT UNSIGNED NOT NULL DEFAULT 5,
  run_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at       TIMESTAMP    NULL,
  locked_by       VARCHAR(60)  NULL,
  last_error      VARCHAR(300) NULL,
  idempotency_key VARCHAR(160) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_idempotency (idempotency_key),
  KEY idx_jobs_due (status, run_at),
  CONSTRAINT fk_jobs_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Message templates as Meta reports them (synced; only approved ones can be sent)
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id      CHAR(36)     NOT NULL,
  name        VARCHAR(512) NOT NULL,
  language    VARCHAR(15)  NOT NULL,
  category    ENUM('marketing', 'utility', 'authentication') NOT NULL,
  status      ENUM('approved', 'pending', 'rejected', 'paused', 'disabled') NOT NULL,
  body_params TINYINT UNSIGNED NOT NULL DEFAULT 0,
  has_image   BOOLEAN      NOT NULL DEFAULT FALSE,
  synced_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_templates (gym_id, name(191), language),
  CONSTRAINT fk_whatsapp_templates_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  gym_id               CHAR(36)     NOT NULL,
  title                VARCHAR(120) NOT NULL,
  body                 VARCHAR(1024) NULL,
  media_id             CHAR(36)     NULL,
  template_id          CHAR(36)     NULL,
  segment              ENUM('active_members', 'expiring_members', 'expired_members', 'opted_in_contacts') NOT NULL,
  status               ENUM('draft', 'scheduled', 'sending', 'done', 'cancelled', 'failed') NOT NULL DEFAULT 'draft',
  recipient_count      INT UNSIGNED NOT NULL DEFAULT 0,
  estimated_cost_minor INT UNSIGNED NULL,               -- an estimate, in the pricing table's currency
  currency             CHAR(3)      NULL,
  scheduled_at         TIMESTAMP    NULL,
  created_by           VARCHAR(64)  NULL,
  confirmed_by         VARCHAR(64)  NULL,
  confirmed_at         TIMESTAMP    NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_whatsapp_campaigns_gym (gym_id, created_at),
  CONSTRAINT fk_whatsapp_campaigns_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_campaigns_created FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_whatsapp_campaigns_confirmed FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- One row per recipient per campaign, so a retry never sends twice
CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
  campaign_id CHAR(36)     NOT NULL,
  contact_id  CHAR(36)     NOT NULL,
  gym_id      CHAR(36)     NOT NULL,
  status      ENUM('pending', 'sent', 'delivered', 'read', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  message_id  CHAR(36)     NULL,
  error_code  VARCHAR(40)  NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id, contact_id),
  KEY idx_campaign_recipients_status (campaign_id, status),
  CONSTRAINT fk_campaign_recipients_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- Daily counts per gym and category, with estimated costs (labelled as estimates)
CREATE TABLE IF NOT EXISTS whatsapp_usage (
  gym_id               CHAR(36)     NOT NULL,
  day                  DATE         NOT NULL,
  kind                 ENUM('inbound', 'service', 'utility', 'marketing', 'authentication', 'ai') NOT NULL,
  count                INT UNSIGNED NOT NULL DEFAULT 0,
  ai_input_tokens      INT UNSIGNED NOT NULL DEFAULT 0,
  ai_output_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
  estimated_cost_minor INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (gym_id, day, kind),
  CONSTRAINT fk_whatsapp_usage_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT
) ENGINE = InnoDB;

-- The rate card the estimates use; platform admins keep it current
CREATE TABLE IF NOT EXISTS whatsapp_pricing (
  category       ENUM('service', 'utility', 'marketing', 'authentication', 'ai_input_1k', 'ai_output_1k') NOT NULL,
  market         VARCHAR(8)   NOT NULL DEFAULT 'IN',
  price_minor    INT UNSIGNED NOT NULL,                 -- per message (or per 1,000 AI tokens)
  currency       CHAR(3)      NOT NULL DEFAULT 'INR',
  effective_from DATE         NOT NULL,
  note           VARCHAR(200) NULL,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (category, market, effective_from)
) ENGINE = InnoDB;

-- Who did what (connect, disconnect, settings, campaigns, admin actions); never a secret
CREATE TABLE IF NOT EXISTS whatsapp_audit (
  id         CHAR(36)    NOT NULL DEFAULT (UUID()),
  gym_id     CHAR(36)    NULL,
  actor_id   VARCHAR(64) NULL,
  action     VARCHAR(60) NOT NULL,
  detail     JSON        NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_whatsapp_audit_gym (gym_id, created_at),
  CONSTRAINT fk_whatsapp_audit_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- Every existing gym gets its connection and agent rows (new gyms get them when created)
INSERT IGNORE INTO whatsapp_connections (gym_id) SELECT id FROM gyms;
INSERT IGNORE INTO whatsapp_agent_settings (gym_id) SELECT id FROM gyms;
