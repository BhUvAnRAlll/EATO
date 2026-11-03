-- Fit Mama and YouTube on programs (asked for by the user on 2026-11-03). In order:
--   1. fitness_programs gets `youtube_kind` ('playlist' or 'video') and `youtube_id`: one YouTube
--      playlist OR one video members follow along with on the program screen (the app embeds
--      YouTube's own player). Never both: a program holds one link, and the two columns are set
--      or empty together (chk_fitness_programs_youtube)
--   2. The built-in "Strong Mom" program is renamed "Fit Mama" (the seed uses INSERT IGNORE, so
--      existing databases keep the old title without this; an admin's own rename is kept)
--   3. (Dropped on 2026-11-03: programs take one video, not a playlist, so Fit Mama gets no link
--      here; the admin pastes its video's link in Admin › Programs)
--   4. An earlier draft of this file added `youtube_playlist_id`: any value in it moves to the new
--      columns and that column is dropped (skipped where it never existed)
--   5. fitness_program_videos: the link's videos in order, each a session (loaded from the YouTube
--      Data API when the admin saves the link or presses Refresh videos)
--   6. fitness_video_progress: the videos each member ticked done (goes with their account)
--   7. fitness_programs gets `youtube_channel` (the creator credited under the player) and
--      `videos_synced_at` (YouTube's answers are refreshed before 25 days and gone after 30)
--
-- Safe to run more than once: each step checks first; only the draft's column is removed. Run after
-- 2026-11-14-coach-insights.sql, by hand, with an account allowed to alter tables
-- (justfit_app can't), for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-11-15-fit-mama.sql

-- 1. The link
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_programs' AND COLUMN_NAME = 'youtube_id'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE fitness_programs ADD COLUMN youtube_kind ENUM(''playlist'', ''video'') NULL AFTER cover_updated_at, ADD COLUMN youtube_id VARCHAR(64) NULL AFTER youtube_kind, ADD CONSTRAINT chk_fitness_programs_youtube CHECK ((youtube_kind IS NULL) = (youtube_id IS NULL))', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The new name
UPDATE fitness_programs
SET title = 'Fit Mama'
WHERE slug = 'strong-mom' AND built_in = TRUE AND title = 'Strong Mom';

-- 3. (dropped: no playlist)

-- 4. The earlier draft's column
SET @has_old := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_programs' AND COLUMN_NAME = 'youtube_playlist_id'
);
SET @sql := IF(@has_old = 1, 'UPDATE fitness_programs SET youtube_kind = ''playlist'', youtube_id = youtube_playlist_id WHERE youtube_id IS NULL AND youtube_playlist_id IS NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF(@has_old = 1, 'ALTER TABLE fitness_programs DROP COLUMN youtube_playlist_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. The videos
CREATE TABLE IF NOT EXISTS fitness_program_videos (
  program_id  CHAR(36)          NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL,
  video_id    VARCHAR(11)       NOT NULL,
  title       VARCHAR(200)      NOT NULL DEFAULT '',
  seconds     INT UNSIGNED      NOT NULL DEFAULT 0,
  PRIMARY KEY (program_id, position),
  UNIQUE KEY uq_fitness_videos_video (program_id, video_id),
  CONSTRAINT fk_fitness_videos_program FOREIGN KEY (program_id) REFERENCES fitness_programs (id)
) ENGINE = InnoDB;

-- 6. The members' ticks
CREATE TABLE IF NOT EXISTS fitness_video_progress (
  user_id     VARCHAR(64)       NOT NULL,
  program_id  CHAR(36)          NOT NULL,
  video_id    VARCHAR(11)       NOT NULL,
  done_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, program_id, video_id),
  KEY idx_fitness_video_progress_program (program_id),
  CONSTRAINT fk_fitness_video_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_fitness_video_progress_program FOREIGN KEY (program_id) REFERENCES fitness_programs (id)
) ENGINE = InnoDB;

-- 7. The credit and when the videos were loaded
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_programs' AND COLUMN_NAME = 'videos_synced_at'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE fitness_programs ADD COLUMN youtube_channel VARCHAR(100) NULL AFTER youtube_id, ADD COLUMN videos_synced_at TIMESTAMP NULL AFTER youtube_channel', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
