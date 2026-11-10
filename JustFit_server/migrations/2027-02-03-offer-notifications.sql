-- Meal marketing phase 4 (2026-11-10): offer notices. The Super Admin announces a live meal coupon
-- and members get an in-app notification in the new 'offers' category. Run once, by hand:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-02-03-offer-notifications.sql
ALTER TABLE notifications
  MODIFY category ENUM('membership', 'pauses', 'attendance', 'gym', 'registration', 'platform', 'offers') NOT NULL;
