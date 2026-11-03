-- Session videos (asked for by the user on 2026-11-03): a program's YouTube video moves from the
-- program to its sessions. The admin adds sessions, each with one embedded YouTube video (never an
-- uploaded file), and can add a video to an exercise session too; the program-level link (and its
-- Follow along) is no longer used. In order:
--   1. fitness_program_sessions gets `youtube_id` (the video, NULL: none), `youtube_channel` (its
--      creator, credited under the player) and `youtube_synced_at` (when that was read from YouTube)
--
-- The program-level columns (fitness_programs.youtube_*) and fitness_program_videos stay as they
-- are, unused; the YouTube refresh job empties fitness_program_videos within 30 days.
-- Safe to run more than once: it checks first, and nothing is deleted. Run after
-- 2026-11-16-program-hero.sql, by hand, with an account allowed to alter tables (justfit_app
-- can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-17-session-videos.sql

-- 1. The session's video
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_program_sessions' AND COLUMN_NAME = 'youtube_id'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE fitness_program_sessions ADD COLUMN youtube_id VARCHAR(11) NULL AFTER minutes, ADD COLUMN youtube_channel VARCHAR(100) NULL AFTER youtube_id, ADD COLUMN youtube_synced_at TIMESTAMP NULL AFTER youtube_channel', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
