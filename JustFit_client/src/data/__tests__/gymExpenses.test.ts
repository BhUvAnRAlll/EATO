// Manage › Expense's month picker and card words (data/gymDashboard.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXPENSE_CATEGORIES, EXPENSE_LABEL, expenseTitle, monthLabel, shiftMonth } from "../gymDashboard.ts";

describe("gym expenses", () => {
  it("moves a month back and forward, across years", () => {
    assert.equal(shiftMonth("2026-11", -1), "2026-10");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-11", -24), "2024-11");
  });

  it("names a month like Nov 2026", () => {
    assert.equal(monthLabel("2026-11"), "Nov 2026");
    assert.equal(monthLabel("2025-01"), "Jan 2025");
  });

  it("a card's line is the title, or the category's name", () => {
    assert.equal(expenseTitle({ category: "rent", title: null }), "Rent");
    assert.equal(expenseTitle({ category: "other", title: "Water cans" }), "Water cans");
  });

  it("lists the same ten categories as the server, Other last", () => {
    assert.deepEqual(EXPENSE_CATEGORIES.map((c) => c.id), ["rent", "salary", "electricity", "water", "equipment", "maintenance", "cleaning", "marketing", "stock", "other"]);
    for (const c of EXPENSE_CATEGORIES) assert.equal(EXPENSE_LABEL[c.id], c.label);
  });
});
