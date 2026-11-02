-- AI Coach chat history (asked for by the user on 2026-11-02): the coach chat is saved on the
-- server so it is still there after leaving the chat or restarting the app, and the coach's
-- context comes from the saved conversation instead of what the app sends. Each message is kept
-- for 7 days from when it was written, then the server deletes it (coach/chatHistory.js).
--   1. coach_chats: one row per conversation; a new one starts when the member changes coach
--   2. coach_chat_messages: the member's messages and the coach's replies (a send that failed is
--      never saved). client_id is the app's id for one send, so a retried send is answered once.
-- Both cascade only from users (nested ON DELETE CASCADE is unreliable on MySQL 9.7), so
-- deleting an account deletes its chat; there is no key from a message to its chat.
--
-- Safe to run more than once: each step checks first, and nothing is deleted. Run after
-- 2026-11-09-fitness-programs.sql, by hand, with an account allowed to create tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-10-coach-chat-history.sql

-- 1. The conversations
CREATE TABLE IF NOT EXISTS coach_chats (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  user_id      VARCHAR(64)       NOT NULL,
  coach        ENUM('arjun', 'priya', 'rohan', 'meera', 'aditya') NOT NULL,  -- who the member was talking to
  created_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_coach_chats_user (user_id, created_at),
  KEY idx_coach_chats_created (created_at),
  CONSTRAINT fk_coach_chats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- 2. The messages, in the order they were saved (id)
CREATE TABLE IF NOT EXISTS coach_chat_messages (
  id           BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  user_id      VARCHAR(64)       NOT NULL,
  chat_id      CHAR(36)          NOT NULL,
  role         ENUM('member', 'coach') NOT NULL,
  text         VARCHAR(1500)     NOT NULL,
  proposals    JSON              NULL,      -- the plan changes a coach reply recommended
  client_id    CHAR(36)          NOT NULL,  -- the app's id for the send (the message and its reply share it)
  created_at   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_coach_chat_messages_send (user_id, client_id, role),
  KEY idx_coach_chat_messages_chat (user_id, chat_id, id),
  KEY idx_coach_chat_messages_created (created_at),
  CONSTRAINT fk_coach_chat_messages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;
