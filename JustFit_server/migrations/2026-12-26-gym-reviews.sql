-- Gym Profile Management, phase 4 (approved by the user on 2026-11-09): members' reviews of a gym
-- branch. Only someone who is or was a member of that branch can review it (matched by the account's
-- verified phone against gym_members); one review per account per branch, which they can change or
-- delete. The gym can reply, and can hide a review's words with a reason (abusive, spam, personal
-- details, not a member, other), but it can never change or remove the rating: a hidden review's
-- stars still count in the branch's average and number of reviews.
--
-- Creates one table; nothing is changed or deleted. Safe to run more than once. Run by hand, from
-- JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-26-gym-reviews.sql

CREATE TABLE IF NOT EXISTS gym_reviews (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id         INT UNSIGNED NOT NULL,                  -- the branch reviewed
  user_id        VARCHAR(64)  NOT NULL,                  -- the member's justFit account (never shown)
  rating         TINYINT UNSIGNED NOT NULL,              -- 1 to 5 stars; only the member changes it
  comment        VARCHAR(500) NULL,
  hidden_reason  ENUM('abusive', 'spam', 'personal', 'not_member', 'other') NULL, -- set: the words are hidden from members
  hidden_at      TIMESTAMP    NULL,
  hidden_by      VARCHAR(64)  NULL,
  reply          VARCHAR(500) NULL,                      -- the gym's answer, shown under the review
  replied_at     TIMESTAMP    NULL,
  replied_by     VARCHAR(64)  NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- when the member last changed it
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_reviews_member (gym_id, user_id),
  KEY idx_gym_reviews_gym_time (gym_id, updated_at),
  KEY idx_gym_reviews_user (user_id),
  CONSTRAINT fk_gym_reviews_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_reviews_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_reviews_hidden_by FOREIGN KEY (hidden_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_reviews_replied_by FOREIGN KEY (replied_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE = InnoDB;
