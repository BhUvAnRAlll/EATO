-- Trainer diet plans (2026-11-10, the user's request): a gym trainer writes one day of meals for a
-- PT client (it repeats every day until changed) and recommends justFit menu meals for breakfast,
-- lunch and dinner, so the member can order them from Coach › Meal Plan. The plan belongs to the
-- gym_members row (the member sees it by their verified phone, like Gym Hub); the meals are one
-- JSON list checked by gym/dietPlanRules.js. Nothing cascades: removing a member removes their
-- plan first in code. A member chooses whether their trainer sees their diet and allergies
-- (profiles.food_shared_with_trainer, off by default).
--
-- Adds one table and one column; nothing is changed or deleted. Safe to run more than once. Run by
-- hand, from JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-27-trainer-diet-plans.sql

CREATE TABLE IF NOT EXISTS trainer_diet_plans (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id   INT UNSIGNED NOT NULL,               -- the PT client (gym_members)
  gym_id      INT UNSIGNED NOT NULL,               -- the member's branch
  trainer_id  VARCHAR(64)  NULL,                   -- who wrote it (NULL once that account is deleted)
  note        VARCHAR(300) NULL,
  meals       JSON         NOT NULL,               -- [{ slot, time, food, kcal, proteinG, picks: [meal id] }]
  version     INT UNSIGNED NOT NULL DEFAULT 1,     -- +1 on every save (the member's notice is once per version)
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trainer_diet_plans_member (member_id),
  KEY idx_trainer_diet_plans_gym (gym_id),
  CONSTRAINT fk_trainer_diet_plans_member FOREIGN KEY (member_id) REFERENCES gym_members (id),
  CONSTRAINT fk_trainer_diet_plans_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_trainer_diet_plans_trainer FOREIGN KEY (trainer_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND COLUMN_NAME = 'food_shared_with_trainer');
SET @sql := IF(@has = 0, 'ALTER TABLE profiles ADD COLUMN food_shared_with_trainer BOOLEAN NOT NULL DEFAULT FALSE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
