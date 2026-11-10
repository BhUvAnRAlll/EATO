-- Meal marketing phase 5 (2026-11-10): referrals. A member shares their code; a new member who
-- enters it gets a personal ₹50-off first-order coupon, and when that first order is delivered the
-- member who shared gets a personal ₹50-off coupon (at most 20). Personal coupons are meal_coupons
-- rows with an owner: only that member can see or use them. Run once, by hand:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-02-04-meal-referrals.sql
ALTER TABLE meal_coupons
  ADD COLUMN owner_user_id VARCHAR(64) NULL AFTER first_order_only,
  ADD CONSTRAINT fk_meal_coupons_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE;

CREATE TABLE referral_codes (
  user_id     VARCHAR(64) NOT NULL,
  code        VARCHAR(12) NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_referral_codes_code (code),
  CONSTRAINT fk_referral_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE meal_referrals (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  referrer_id         VARCHAR(64)  NOT NULL,
  referred_id         VARCHAR(64)  NOT NULL,
  rewarded_at         TIMESTAMP    NULL,      -- the friend's first order was delivered
  referrer_coupon_id  INT UNSIGNED NULL,      -- the reward (NULL once the 20 rewards are used up)
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_referrals_referred (referred_id),
  KEY idx_meal_referrals_referrer (referrer_id),
  CONSTRAINT fk_meal_referrals_referrer FOREIGN KEY (referrer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_referrals_referred FOREIGN KEY (referred_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_meal_referrals_coupon FOREIGN KEY (referrer_coupon_id) REFERENCES meal_coupons (id) ON DELETE SET NULL
) ENGINE = InnoDB;
