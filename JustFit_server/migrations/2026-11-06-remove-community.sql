-- Removes Community and gyms for good (asked for by the user on 2026-11-01): the feed, posts,
-- comments, likes, polls, stories, friends, follows, blocks, direct messages, community profiles
-- and reports; gyms with their members, invitations, announcements, events, visits (QR
-- attendance), notices, packages, FAQs and assistant questions; and the WhatsApp gym agent with
-- its job queue. In order:
--   1. the workout exercise library loses its two unused photo/video columns, which pointed at
--      community_media (nothing ever filled them)
--   2. the 47 community, gym and WhatsApp tables are dropped
-- Kept as history: admin_audit_log rows about gyms, posts and reports, ai_usage rows of the gym
-- assistant (their gym_id is now a plain id), and analytics_events rows of the old community
-- events. Uploaded images stay on disk in JustFit_server/uploads/ (or UPLOAD_DIR) until you
-- delete that folder yourself.
--
-- Safe to run more than once: each step checks first. Run after 2026-11-05-coach-meal-options.sql,
-- by hand, with an account allowed to alter and drop tables (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-06-remove-community.sql
-- This deletes data and can't be undone: back up the database first, for example:
--   /usr/local/mysql/bin/mysqldump -u root -p justfit > ~/justfit-before-community-removal.sql

-- 1. The workout library's media columns (foreign keys first, then the columns)
SET @has_fk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_exercise_library'
    AND CONSTRAINT_NAME = 'fk_workout_library_thumbnail' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@has_fk = 1, 'ALTER TABLE workout_exercise_library DROP FOREIGN KEY fk_workout_library_thumbnail', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_exercise_library'
    AND CONSTRAINT_NAME = 'fk_workout_library_video' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@has_fk = 1, 'ALTER TABLE workout_exercise_library DROP FOREIGN KEY fk_workout_library_video', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_exercise_library' AND COLUMN_NAME = 'thumbnail_media_id'
);
SET @sql := IF(@has_col = 1, 'ALTER TABLE workout_exercise_library DROP COLUMN thumbnail_media_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workout_exercise_library' AND COLUMN_NAME = 'video_media_id'
);
SET @sql := IF(@has_col = 1, 'ALTER TABLE workout_exercise_library DROP COLUMN video_media_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The tables. They only reference each other (and users), so the checks are paused for
-- the drops alone and every table goes whatever the order.
SET FOREIGN_KEY_CHECKS = 0;

-- WhatsApp gym agent and its job queue
DROP TABLE IF EXISTS whatsapp_audit;
DROP TABLE IF EXISTS whatsapp_pricing;
DROP TABLE IF EXISTS whatsapp_usage;
DROP TABLE IF EXISTS whatsapp_campaign_recipients;
DROP TABLE IF EXISTS whatsapp_campaigns;
DROP TABLE IF EXISTS whatsapp_templates;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS whatsapp_webhook_events;
DROP TABLE IF EXISTS whatsapp_link_codes;
DROP TABLE IF EXISTS whatsapp_messages;
DROP TABLE IF EXISTS whatsapp_media;
DROP TABLE IF EXISTS whatsapp_conversations;
DROP TABLE IF EXISTS whatsapp_contacts;
DROP TABLE IF EXISTS whatsapp_agent_settings;
DROP TABLE IF EXISTS whatsapp_connections;

-- Gyms and the owner portal
DROP TABLE IF EXISTS gym_assistant_questions;
DROP TABLE IF EXISTS gym_faqs;
DROP TABLE IF EXISTS gym_member_plans;
DROP TABLE IF EXISTS gym_notice_recipients;
DROP TABLE IF EXISTS gym_notices;
DROP TABLE IF EXISTS gym_scan_failures;
DROP TABLE IF EXISTS gym_visits;
DROP TABLE IF EXISTS gym_event_rsvps;
DROP TABLE IF EXISTS gym_events;
DROP TABLE IF EXISTS gym_announcements;
DROP TABLE IF EXISTS gym_invitations;
DROP TABLE IF EXISTS gym_members;

-- Community
DROP TABLE IF EXISTS community_friendships;
DROP TABLE IF EXISTS community_close_friends;
DROP TABLE IF EXISTS community_blocks;
DROP TABLE IF EXISTS community_follows;
DROP TABLE IF EXISTS community_profiles;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS community_reports;
DROP TABLE IF EXISTS community_story_views;
DROP TABLE IF EXISTS community_stories;
DROP TABLE IF EXISTS community_comments;
DROP TABLE IF EXISTS community_poll_votes;
DROP TABLE IF EXISTS community_poll_options;
DROP TABLE IF EXISTS community_post_tags;
DROP TABLE IF EXISTS community_post_likes;
DROP TABLE IF EXISTS community_post_media;
DROP TABLE IF EXISTS community_posts;
DROP TABLE IF EXISTS gyms;
DROP TABLE IF EXISTS community_media;

SET FOREIGN_KEY_CHECKS = 1;
