// Gym Profile phase 2 (2026-11-09): membership plans and PT packages the gym manages for members.
// Benefits, Best value, status and the gym's own order, as the server checks and lays them out.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/rules");
const discover = require("../gym/discoverRules");

describe("Plan options: benefits, best value, status and order", () => {
  it("takes benefits as a short list, tidied, once each", () => {
    const body = rules.catalogBody({ kind: "plan", name: "Gold", duration: 3, price: 4500, benefits: ["  Steam   bath ", "1 diet consult"] }, { creating: true });
    assert.deepEqual(body.benefits, ["Steam bath", "1 diet consult"]);
    assert.deepEqual(rules.catalogBody({ benefits: [] }, { creating: false }).benefits, []);
    assert.throws(() => rules.catalogBody({ benefits: ["Sauna", "sauna"] }, { creating: false }), /twice/);
    assert.throws(() => rules.catalogBody({ benefits: ["x"] }, { creating: false }), /2 to 60/);
    assert.throws(() => rules.catalogBody({ benefits: Array.from({ length: 9 }, (_, i) => `Benefit ${i}`) }, { creating: false }), /up to 8/);
    assert.throws(() => rules.catalogBody({ benefits: "Sauna" }, { creating: false }), /up to 8/);
    assert.throws(() => rules.catalogBody({ kind: "product", name: "Whey", price: 2500, benefits: ["Tasty"] }, { creating: true }), /Only plans and PT/);
  });

  it("takes Best value only on an active membership plan", () => {
    assert.equal(rules.catalogBody({ kind: "plan", name: "Gold", duration: 12, price: 12000, bestValue: true }, { creating: true }).bestValue, true);
    assert.throws(() => rules.catalogBody({ kind: "pt", name: "PT", duration: 1, price: 5000, bestValue: true }, { creating: true }), /membership plan/);
    assert.throws(() => rules.catalogBody({ bestValue: "yes" }, { creating: false }), /best value/);
    assert.throws(() => rules.catalogBody({ bestValue: true, status: "inactive" }, { creating: false }), /active plan/);
  });

  it("takes Active, Inactive or Archived, nothing else", () => {
    for (const status of rules.CATALOG_STATUSES) assert.equal(rules.catalogBody({ status }, { creating: false }).status, status);
    for (const bad of ["deleted", "ACTIVE", "", 1, "active'; DROP TABLE gyms; --"]) assert.throws(() => rules.catalogBody({ status: bad }, { creating: false }), /Active, Inactive or Archived/);
    assert.throws(() => rules.catalogBody({ status: "active", gymId: 2 }, { creating: false }), /Unexpected field|fields we don't use/);
  });

  it("reorders one kind with every item of it, once each", () => {
    assert.deepEqual(rules.catalogOrder({ kind: "plan", ids: [3, 1, 2] }, [1, 2, 3]), [3, 1, 2]);
    assert.throws(() => rules.catalogOrder({ kind: "plan", ids: [1, 2] }, [1, 2, 3]), /every item/);
    assert.throws(() => rules.catalogOrder({ kind: "plan", ids: [1, 2, 9] }, [1, 2, 3]), /every item/);
    assert.throws(() => rules.catalogOrder({ kind: "plan", ids: [1, 1, 2] }, [1, 2, 3]), /every item/);
    assert.throws(() => rules.catalogOrder({ kind: "food", ids: [] }, []), /reorder/);
  });

  it("lays plans out in the gym's order, with benefits and its Best value; savings against the shortest", () => {
    const items = [
      { id: 1, kind: "plan", name: "Monthly", duration: 1, duration_unit: "months", price: 1500, sort_order: 2 },
      { id: 2, kind: "plan", name: "Annual", duration: 12, duration_unit: "months", price: 12000, sort_order: 1, best_value: 1, benefits: JSON.stringify(["Steam bath"]) },
      { id: 3, kind: "plan", name: "Quarterly", duration: 3, duration_unit: "months", price: 4200, sort_order: 0 },
    ];
    const plans = discover.comparePlans(items);
    assert.deepEqual(plans.map((p) => p.name), ["Annual", "Monthly", "Quarterly"], "ordered first, then the rest by length");
    assert.deepEqual(plans.map((p) => [p.bestValue, p.savesPerMonth]), [[true, 500], [false, 0], [false, 100]]);
    assert.deepEqual(plans[0].benefits, ["Steam bath"]);
    assert.ok(!("order" in plans[0]), "the order itself isn't sent");
    // Never ordered: shortest first, as before
    assert.deepEqual(discover.comparePlans(items.map((i) => ({ ...i, sort_order: 0 }))).map((p) => p.name), ["Monthly", "Quarterly", "Annual"]);
    assert.deepEqual(discover.readBenefits("not json"), []);
  });
});
