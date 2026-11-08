-- Gym expenses (asked for by the user on 2026-11-08): Manage › Expense keeps each branch's
-- spending (rent, salaries, electricity, equipment…), with who was paid, cash or online, an
-- optional note and an optional photo of the bill. Wallet shows the month's spending and the net.
-- A wrong entry can be edited; the gym admin can delete one (audited). In order:
--   1. gym_expenses, one row per expense, per branch
--
-- The bill photo is a file on the server's disk (EXPENSE_BILL_DIR, by default uploads/expense-bills,
-- git-ignored; gym/expenseBills.js) under a random name; the row keeps only that name.
--
-- Safe to run more than once: it checks first, and nothing is deleted. Before it runs, Manage ›
-- Expense says this migration is needed and Wallet works as before. Run after
-- 2026-12-09-enquiry-referrer.sql, by hand, with an account allowed to create tables, for example:
--   /usr/local/mysql/bin/mysql -u root -p justfit < migrations/2026-12-10-gym-expenses.sql

-- 1. The expenses
CREATE TABLE IF NOT EXISTS gym_expenses (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gym_id      INT UNSIGNED NOT NULL,                -- the branch that spent it
  category    ENUM('rent', 'salary', 'electricity', 'water', 'equipment', 'maintenance', 'cleaning', 'marketing', 'stock', 'other') NOT NULL,
  title       VARCHAR(80)  NULL,                    -- what it was; needed for 'other'
  paid_to     VARCHAR(80)  NULL,                    -- the landlord, a trainer, a vendor
  method      ENUM('online', 'cash') NOT NULL,
  amount      INT UNSIGNED NOT NULL,                -- rupees
  spent_on    DATE         NOT NULL,
  note        VARCHAR(200) NULL,
  bill_key    VARCHAR(64)  NULL,                    -- the bill photo's file name in EXPENSE_BILL_DIR; NULL: none
  created_by  VARCHAR(64)  NULL,
  updated_by  VARCHAR(64)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gym_expenses_day (gym_id, spent_on, id),
  CONSTRAINT fk_gym_expenses_gym FOREIGN KEY (gym_id) REFERENCES gyms (id),
  CONSTRAINT fk_gym_expenses_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gym_expenses_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_gym_expenses_amount CHECK (amount BETWEEN 1 AND 1000000)
) ENGINE = InnoDB;
