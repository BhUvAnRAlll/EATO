// Meal ordering's pure rules (meals/rules.js): India's time, the 2-hour cutoff, the order days,
// the admin's meal and delivery-time bodies, a member's order body and the order's steps.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../meals/rules");
const { ValidationError } = require("../profile");

// 2026-11-09 09:00 in India = 03:30 UTC
const at = (isoIndia) => Date.parse(`${isoIndia}+05:30`);
const slots = structuredClone(rules.DEFAULT_SLOTS);

describe("meal rules: time", () => {
  it("reads India's date and minutes, also across UTC midnight", () => {
    assert.deepEqual(rules.indiaNow(at("2026-11-09T09:00:00")), { date: "2026-11-09", minutes: 540 });
    assert.deepEqual(rules.indiaNow(at("2026-11-10T01:15:00")), { date: "2026-11-10", minutes: 75 });
    assert.equal(rules.addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(rules.hhmm("07:30:00"), "07:30");
  });

  it("closes a meal time 2 hours before it starts", () => {
    assert.equal(rules.cutoffAt("2026-11-09", "12:30"), at("2026-11-09T10:30:00"));
    // A meal time starting at 01:00 closes at 23:00 the day before
    assert.equal(rules.cutoffAt("2026-11-10", "01:00"), at("2026-11-09T23:00:00"));
  });

  it("lists 7 days with each meal time open or closed", () => {
    const days = rules.orderDays(slots, at("2026-11-09T10:29:00"));
    assert.equal(days.length, 7);
    assert.equal(days[0].date, "2026-11-09");
    assert.equal(days[6].date, "2026-11-15");
    const today = Object.fromEntries(days[0].slots.map((s) => [s.slot, s.open]));
    assert.deepEqual(today, { breakfast: false, lunch: true, dinner: true });
    assert.ok(days[1].slots.every((s) => s.open));
    // One minute later lunch has closed
    const later = rules.orderDays(slots, at("2026-11-09T10:30:00"));
    assert.equal(later[0].slots.find((s) => s.slot === "lunch").open, false);
  });

  it("names why a meal time can't be ordered", () => {
    const now = at("2026-11-09T18:00:00");
    assert.equal(rules.slotProblem(slots, "2026-11-10", "breakfast", now), null);
    assert.match(rules.slotProblem(slots, "2026-11-09", "dinner", now), /closed/);
    assert.match(rules.slotProblem(slots, "2026-11-08", "lunch", now), /today to 6 days/);
    assert.match(rules.slotProblem(slots, "2026-11-16", "lunch", now), /today to 6 days/);
    const off = { ...slots, dinner: { ...slots.dinner, active: false } };
    assert.match(rules.slotProblem(off, "2026-11-10", "dinner", now), /aren't delivering dinner/);
  });
});

describe("meal rules: the admin", () => {
  const meal = { name: "  Paneer   Tikka Bowl ", description: "", diet: "vegetarian", calories: 520, proteinG: 32.44, carbsG: 48, fatG: 18, price: 249 };

  it("accepts a meal, tidies it and keeps the price in paise", () => {
    assert.deepEqual(rules.mealBody(meal), {
      name: "Paneer Tikka Bowl", description: null, diet: "vegetarian", calories: 520, proteinG: 32.4, carbsG: 48, fatG: 18, pricePaise: 24900,
      mrpPaise: null, tags: [], servingSize: null, ingredients: null, available: true,
    });
  });

  it("refuses a bad meal", () => {
    for (const bad of [
      { ...meal, diet: "keto" }, { ...meal, name: "a" }, { ...meal, calories: 0 }, { ...meal, calories: 520.5 }, { ...meal, price: 0 },
      { ...meal, price: 10.5 }, { ...meal, proteinG: -1 }, { ...meal, carbsG: "48" }, { ...meal, isPopular: true }, { ...meal, name: "x".repeat(81) },
      { ...meal, name: "Bowl\u0000" }, null, [],
    ]) assert.throws(() => rules.mealBody(bad), ValidationError, JSON.stringify(bad));
  });

  it("makes a safe meal id from the name", () => {
    assert.equal(rules.mealIdFor("Paneer Tikka Bowl!", () => "a1b2c3"), "paneer-tikka-bowl-a1b2c3");
    assert.equal(rules.mealIdFor("ಮಸಾಲೆ ದೋಸೆ", () => "a1b2c3"), "meal-a1b2c3");
    assert.match(rules.mealIdFor("x".repeat(120)), /^[a-z0-9-]{1,64}$/);
    assert.throws(() => rules.mealId("../etc"), ValidationError);
    assert.throws(() => rules.mealId("a' OR 1=1"), ValidationError);
  });

  it("takes all three delivery times", () => {
    const body = { slots: { breakfast: { startsAt: "07:30", endsAt: "09:00", active: true }, lunch: { startsAt: "12:00", endsAt: "14:00", active: true }, dinner: { startsAt: "19:00", endsAt: "21:30", active: false } } };
    const withCapacity = Object.fromEntries(Object.entries(body.slots).map(([k, v]) => [k, { ...v, capacity: null }]));
    assert.deepEqual(rules.slotsBody(body), withCapacity, "no capacity given = no limit");
    assert.equal(rules.slotsBody({ slots: { ...body.slots, lunch: { ...body.slots.lunch, capacity: 120 } } }).lunch.capacity, 120);
    for (const bad of [
      { slots: { ...body.slots, lunch: { startsAt: "14:00", endsAt: "12:00", active: true } } },
      { slots: { ...body.slots, lunch: { startsAt: "25:00", endsAt: "26:00", active: true } } },
      { slots: { ...body.slots, lunch: { startsAt: "12:00", endsAt: "14:00" } } },
      { slots: { ...body.slots, snack: { startsAt: "16:00", endsAt: "17:00", active: true } } },
      { slots: { breakfast: body.slots.breakfast } },
      { slots: body.slots, extra: 1 },
      { slots: { ...body.slots, lunch: { ...body.slots.lunch, capacity: 0 } } },
      { slots: { ...body.slots, lunch: { ...body.slots.lunch, capacity: 2.5 } } },
    ]) assert.throws(() => rules.slotsBody(bad), ValidationError);
  });

  it("moves an order one step at a time", () => {
    assert.deepEqual(rules.advanceBody({ from: "placed" }), { from: "placed", to: "preparing" });
    assert.deepEqual(rules.advanceBody({ from: "out_for_delivery" }), { from: "out_for_delivery", to: "delivered" });
    for (const from of ["delivered", "cancelled", "nope", undefined]) assert.throws(() => rules.advanceBody({ from }), ValidationError);
  });

  it("needs a reason for the admin's cancel, not for the member's", () => {
    assert.throws(() => rules.cancelBody({}, { required: true }), ValidationError);
    assert.throws(() => rules.cancelBody({ reason: "no" }, { required: true }), ValidationError);
    assert.deepEqual(rules.cancelBody({ reason: " Out of paneer " }, { required: true }), { reason: "Out of paneer" });
    assert.deepEqual(rules.cancelBody(undefined, { required: false }), { reason: null });
  });

  it("reads the orders day: today by default, a year back to a week ahead", () => {
    const now = at("2026-11-09T09:00:00");
    assert.equal(rules.adminDay({}, now), "2026-11-09");
    assert.equal(rules.adminDay({ day: "2026-11-15" }, now), "2026-11-15");
    for (const day of ["2026-11-16", "2025-11-01", "09-11-2026", "2026-11-09' OR 1=1"]) assert.throws(() => rules.adminDay({ day }, now), ValidationError);
    assert.throws(() => rules.adminDay({ day: "2026-11-09", sort: "x" }, now), ValidationError);
  });
});

describe("meal rules: members", () => {
  const order = { clientId: "0b6f3a3e-6f1c-4c3a-9d1e-2f3b4c5d6e7f", addressId: 3, date: "2026-11-10", slot: "lunch", items: [{ mealId: "paneer-bowl", quantity: 2 }] };

  it("accepts an order", () => {
    assert.deepEqual(rules.orderBody(order), { ...order, couponCode: null });
  });

  it("refuses a bad order", () => {
    for (const bad of [
      { ...order, slot: "snack" }, { ...order, items: [] }, { ...order, items: [{ mealId: "a", quantity: 4 }] },
      { ...order, items: [{ mealId: "a", quantity: 1 }, { mealId: "a", quantity: 1 }] }, { ...order, items: [{ mealId: "a", quantity: 1, price: 1 }] },
      { ...order, addressId: "3" }, { ...order, clientId: "x" }, { ...order, userId: "someone" }, { ...order, total: 1 },
      { ...order, items: Array.from({ length: 11 }, (_, i) => ({ mealId: `m${i}`, quantity: 1 })) },
    ]) assert.throws(() => rules.orderBody(bad), ValidationError, JSON.stringify(bad));
  });

  it("reads the menu's search and diet", () => {
    assert.deepEqual(rules.menuQuery({ search: " dal ", diet: "vegan" }), { search: "dal", diet: "vegan" });
    assert.deepEqual(rules.menuQuery({}), { search: null, diet: null });
    assert.throws(() => rules.menuQuery({ diet: "keto" }), ValidationError);
    assert.throws(() => rules.menuQuery({ search: "x".repeat(41) }), ValidationError);
  });

  it("writes the address as one line and the meal's picture", () => {
    assert.equal(rules.addressLine({ house: "4B", street: "MG Road", landmark: "SIT", city: "Tumakuru", pincode: "572103" }), "4B, MG Road, Near SIT, Tumakuru, 572103");
    assert.equal(rules.mealImageUrl({ id: "dal-bowl-1a2b3c", image_key: "0b6f3a3e-6f1c-4c3a-9d1e-2f3b4c5d6e7f.jpg", image_url: "asset:hero-bowl" }), "/api/meals/dal-bowl-1a2b3c/photo?v=0b6f3a3e-6f1c-4c3a-9d1e-2f3b4c5d6e7f");
    assert.equal(rules.mealImageUrl({ id: "x", image_key: null, image_url: "asset:hero-bowl" }), "asset:hero-bowl");
    assert.match(rules.testPaymentRef(), /^TEST-[0-9A-F]{10}$/);
  });
});
