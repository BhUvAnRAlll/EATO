-- Gym Hub ecosystem (the user's brief of 2026-11-09, Super Admin › members and staff): a justFit
-- admin can suspend an account that is misused or compromised, with a reason, and reactivate it.
-- While suspended, its sessions are revoked, every request is refused and a new sign-in code
-- doesn't open it. justFit admins can't be suspended this way. Reactivating removes the row; the
-- admin audit log keeps both steps.
--
-- Creates one table (removed with the account); nothing else changes. Safe to run more than once.
-- Run by hand, from JustFit_server, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2027-01-07-account-suspensions.sql

CREATE TABLE IF NOT EXISTS account_suspensions (
  user_id       VARCHAR(64)  NOT NULL,
  reason        VARCHAR(200) NOT NULL,
  suspended_by  VARCHAR(64)  NULL,
  suspended_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_account_suspensions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_account_suspensions_by FOREIGN KEY (suspended_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
