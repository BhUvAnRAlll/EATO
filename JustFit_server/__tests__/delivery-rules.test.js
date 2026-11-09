// Delivery partners and deliveries: the pure rules (delivery/rules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../delivery/rules");
const { ValidationError } = require("../profile");

const partner = (over = {}) => ({ name: "Ravi Kumar", phone: "+91 98765 43210", vehicle: "bike", vehicleNumber: "ka 01 ab 1234", idStatus: "verified", active: true, available: true, maxOrders: 3, pincodes: ["560095", "560034", "560095"], ...over });
const p = (over = {}) => ({ id: 1, active: true, available: true, idStatus: "verified", pincodes: new Set(["560095"]), carrying: 0, maxOrders: 3, ...over });

describe("delivery rules", () => {
  it("reads a partner: number cleaned, vehicle number in capitals, pincodes once", () => {
    const got = rules.partnerBody(partner());
    assert.equal(got.phone, "9876543210");
    assert.equal(got.vehicleNumber, "KA 01 AB 1234");
    assert.deepEqual(got.pincodes, ["560034", "560095"]);
    assert.equal(rules.partnerBody(partner({ vehicle: "on_foot", vehicleNumber: null })).vehicleNumber, null);
    for (const bad of [partner({ vehicle: "truck" }), partner({ idStatus: "ok" }), partner({ maxOrders: 0 }), partner({ maxOrders: 11 }), partner({ pincodes: [] }), partner({ pincodes: ["5600"] }), partner({ active: "yes" }), partner({ vehicleNumber: "KA<script>" }), partner({ phone: "123" }), partner({ userId: "x" })]) {
      assert.throws(() => rules.partnerBody(bad), ValidationError, JSON.stringify(bad).slice(0, 60));
    }
  });

  it("steps one at a time; failing needs a reason, other needs a note", () => {
    assert.equal(rules.nextStep("assigned"), "accepted");
    assert.equal(rules.nextStep("at_customer"), "delivered");
    assert.equal(rules.nextStep("delivered"), null);
    assert.deepEqual(rules.advanceBody({ from: "picked_up" }), { from: "picked_up", to: "out_for_delivery" });
    assert.throws(() => rules.advanceBody({ from: "failed" }), ValidationError);
    assert.throws(() => rules.advanceBody({ from: "assigned", to: "delivered" }), ValidationError);
    assert.deepEqual(rules.failBody({ reason: "customer_unavailable" }), { reason: "customer_unavailable", note: null });
    assert.throws(() => rules.failBody({ reason: "other" }), ValidationError);
    assert.throws(() => rules.failBody({ reason: "rain" }), ValidationError);
    assert.deepEqual(rules.assignBody({}), { partnerId: null });
    assert.deepEqual(rules.assignBody(undefined), { partnerId: null });
    assert.throws(() => rules.assignBody({ partnerId: "2" }), ValidationError);
  });

  it("says why a partner can't take an order, and picks the least busy free one", () => {
    assert.equal(rules.partnerProblem(p(), "560095"), null);
    assert.equal(rules.partnerProblem(p({ active: false }), "560095"), "inactive");
    assert.equal(rules.partnerProblem(p({ idStatus: "pending" }), "560095"), "ID not verified");
    assert.equal(rules.partnerProblem(p({ available: false }), "560095"), "not available");
    assert.equal(rules.partnerProblem(p(), "560001"), "doesn't cover this pincode");
    assert.equal(rules.partnerProblem(p({ carrying: 3 }), "560095"), "carrying as many orders as they can");
    assert.equal(rules.choosePartner([p({ id: 1, carrying: 2 }), p({ id: 2, carrying: 0 }), p({ id: 3, available: false })], "560095").id, 2);
    assert.equal(rules.choosePartner([p({ carrying: 3 })], "560095"), null);
  });
});
