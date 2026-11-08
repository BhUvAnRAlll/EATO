// Gym expenses: what Add Expense may send and the list's filters (gym/expenseRules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/expenseRules");

const TODAY = "2026-11-08";
const refuses = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));
const valid = { category: "rent", method: "online", amount: 25000 };

describe("gym expense rules", () => {
  it("an expense: the category, mode and amount, the rest optional; the day defaults to today", () => {
    assert.deepEqual(rules.expenseBody(valid, TODAY), { category: "rent", title: null, paidTo: null, method: "online", amount: 25000, spentOn: TODAY, note: null });
    assert.deepEqual(
      rules.expenseBody({ category: "salary", title: " November  salary ", paidTo: "Ravi <b>", method: "cash", amount: 12000, spentOn: "2026-11-01", note: "Paid in full" }, TODAY),
      { category: "salary", title: "November salary", paidTo: "Ravi b", method: "cash", amount: 12000, spentOn: "2026-11-01", note: "Paid in full" },
    );
    assert.equal(rules.expenseBody({ ...valid, title: "", paidTo: null, note: "" }, TODAY).title, null, "empty fields read as none");
    assert.equal(rules.expenseBody({ ...valid, category: "other", title: "Water cans" }, TODAY).title, "Water cans");
    assert.equal(rules.expenseBody({ ...valid, spentOn: "2025-11-08" }, TODAY).spentOn, "2025-11-08", "a year back is allowed");
  });

  it("refuses a bad expense", () => {
    refuses(() => rules.expenseBody({ ...valid, gymId: 2 }, TODAY), /fields we don't use/);
    refuses(() => rules.expenseBody(null, TODAY), /JSON/);
    refuses(() => rules.expenseBody({ ...valid, category: "party" }, TODAY), /spent on/);
    refuses(() => rules.expenseBody({ ...valid, category: "other" }, TODAY), /what it was for/);
    refuses(() => rules.expenseBody({ ...valid, method: "card" }, TODAY), /online or cash/);
    for (const amount of [0, -5, 12.5, "500", 1_000_001, null]) refuses(() => rules.expenseBody({ ...valid, amount }, TODAY), /whole rupees/);
    for (const spentOn of ["2026-11-09", "2025-11-07", "2026-02-30", "08-11-2026", 20261108]) refuses(() => rules.expenseBody({ ...valid, spentOn }, TODAY), /a year ago to today/);
    refuses(() => rules.expenseBody({ ...valid, title: "x".repeat(81) }, TODAY), /80 characters/);
    refuses(() => rules.expenseBody({ ...valid, paidTo: "x".repeat(81) }, TODAY), /80 characters/);
    refuses(() => rules.expenseBody({ ...valid, note: "x".repeat(201) }, TODAY), /200 characters/);
    refuses(() => rules.expenseBody({ ...valid, note: 12 }, TODAY), /200 characters/);
  });

  it("the list: this month by default, up to 24 months back, a category, a search and a page", () => {
    assert.deepEqual(rules.expensesQuery({}, TODAY), { month: "2026-11", from: "2026-11-01", to: "2026-11-30", category: null, search: "", page: 1 });
    assert.deepEqual(rules.expensesQuery({ month: "2024-11", category: "salary", search: " ravi ", page: "3" }, TODAY), { month: "2024-11", from: "2024-11-01", to: "2024-11-30", category: "salary", search: "ravi", page: 3 });
    assert.equal(rules.expensesQuery({ category: "all" }, TODAY).category, null);
    assert.equal(rules.expensesQuery({ month: "2025-02" }, TODAY).to, "2025-02-28", "February's last day");
    assert.equal(rules.monthRange("2024-02").to, "2024-02-29", "a leap February");
    for (const month of ["2026-12", "2024-10", "2026-13", "2026-1", "x' OR 1=1"]) refuses(() => rules.expensesQuery({ month }, TODAY), /last 24 months/);
    refuses(() => rules.expensesQuery({ category: "rent' --" }, TODAY), /category/);
    refuses(() => rules.expensesQuery({ search: "x".repeat(61) }, TODAY), /60 characters/);
    for (const page of ["0", "-1", "a", "99999"]) refuses(() => rules.expensesQuery({ page }, TODAY), /page/);
  });

  it("months move across years", () => {
    assert.equal(rules.shiftMonth("2026-01", -1), "2025-12");
    assert.equal(rules.shiftMonth("2026-11", -24), "2024-11");
    assert.deepEqual(rules.monthRange("2026-04"), { from: "2026-04-01", to: "2026-04-30" });
  });
});
