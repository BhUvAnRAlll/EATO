const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/joinRules");

describe("Gym Hub join request rules", () => {
  it("takes a plan, a message, both or neither", () => {
    assert.deepEqual(rules.joinBody({}), { itemId: null, note: null });
    assert.deepEqual(rules.joinBody({ itemId: 7, note: "  Evenings   after 6, please  " }), { itemId: 7, note: "Evenings after 6, please" });
    assert.deepEqual(rules.joinBody({ itemId: null, note: "   " }), { itemId: null, note: null });
    assert.deepEqual(rules.joinBody({ note: "ಸಂಜೆ ಕರೆ ಮಾಡಿ" }), { itemId: null, note: "ಸಂಜೆ ಕರೆ ಮಾಡಿ" });
  });

  it("refuses what it doesn't expect", () => {
    for (const [body, message] of [
      [[], /as an object/],
      [{ itemId: 7, phone: "9876543210" }, /Unexpected field: phone/],
      [{ itemId: 7, userId: "user_x" }, /Unexpected field: userId/],
      [{ itemId: "7" }, /this gym's plans/],
      [{ itemId: 0 }, /this gym's plans/],
      [{ itemId: 1.5 }, /this gym's plans/],
      [{ note: 5 }, /as text/],
      [{ note: "x".repeat(201) }, /200 characters/],
      [{ note: "bell\u0007" }, /can't show/],
    ]) assert.throws(() => rules.joinBody(body), message, JSON.stringify(body));
  });

  it("writes the plan as the gym will read it", () => {
    assert.equal(rules.planLabel({ kind: "plan", name: "Gold", duration: 3, duration_unit: "months", price: 4500 }), "Gold · 3 Months · ₹4,500");
    assert.equal(rules.planLabel({ kind: "plan", name: "Monthly", duration: 1, duration_unit: "months", price: 1500 }), "Monthly · 1 Month · ₹1,500");
    assert.equal(rules.planLabel({ kind: "plan", name: "Trial", duration: 15, duration_unit: "days", price: 600 }), "Trial · 15 Days · ₹600");
    assert.equal(rules.planLabel({ kind: "pt", name: "12 sessions", duration: null, duration_unit: null, price: 5000 }), "PT · 12 sessions · ₹5,000");
    assert.ok(rules.planLabel({ kind: "plan", name: "x".repeat(200), duration: 1, duration_unit: "months", price: 1 }).length <= 120);
  });

  it("says where a request stands in the member's words", () => {
    assert.deepEqual(["new", "follow_up", "joined", "lost"].map(rules.requestState), ["sent", "in_touch", "joined", "closed"]);
    assert.deepEqual(["new", "follow_up", "joined", "lost"].map(rules.isOpen), [true, true, false, false]);
  });
});
