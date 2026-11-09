-- Home's jiggle mode (2026-11-09): the order a gym admin or Staff login arranged the Today tiles
-- in, per branch. NULL = the default order. Nothing else reads it.
ALTER TABLE gym_staff ADD COLUMN home_tiles JSON NULL AFTER selected_at;
