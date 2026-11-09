// Kitchens' pure rules (kitchens/rules.js): the kitchen, its status and roster bodies, the
// dashboard's day, opening hours and delayed orders.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../kitchens/rules");
const { ValidationError } = require("../profile");

const week = (sessions) => Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, sessions]));
const kitchen = (over = {}) => ({
  name: "Koramangala Kitchen", contactName: "Suresh Rao", phone: "+91 98765 43210", email: "Kitchen@Example.com", address: "12, 5th Block, 80 Feet Road",
  area: "Koramangala", city: "Bengaluru", pincode: "560095", latitude: 12.9352, longitude: 77.6245, hours: week([["06:00", "22:00"]]),
  pincodes: ["560095", "560034", "560095"], maxDailyOrders: 400, prepCapacity: 120, radiusKm: 6.25, ...over,
});
const at = (isoIndia) => Date.parse(`${isoIndia}+05:30`);

describe("kitchen rules", () => {
  it("reads a kitchen: phone and email cleaned, pincodes once and sorted, radius to 0.1 km", () => {
    const k = rules.kitchenBody(kitchen());
    assert.equal(k.phone, "9876543210");
    assert.equal(k.email, "kitchen@example.com");
    assert.deepEqual(k.pincodes, ["560034", "560095"]);
    assert.equal(k.radiusKm, 6.3);
    assert.deepEqual(k.hours.sun, [["06:00", "22:00"]]);
    assert.equal(rules.kitchenBody(kitchen({ latitude: null, longitude: null, email: "", area: "" })).area, null);
  });

  it("refuses a bad kitchen", () => {
    for (const bad of [
      kitchen({ name: "K" }), kitchen({ phone: "12345" }), kitchen({ pincode: "012345" }), kitchen({ pincodes: [] }), kitchen({ pincodes: ["5600"] }),
      kitchen({ pincodes: Array.from({ length: 101 }, (_, i) => String(500000 + i)) }), kitchen({ maxDailyOrders: 0 }), kitchen({ prepCapacity: 1.5 }),
      kitchen({ radiusKm: 80 }), kitchen({ latitude: 51.5, longitude: -0.12 }), kitchen({ latitude: 12.9 , longitude: null }), kitchen({ hours: undefined }),
      kitchen({ hours: week([["22:00", "06:00"]]) }), kitchen({ status: "active" }), kitchen({ name: "Bad\u0000name" }), kitchen({ email: "nope" }), null, [],
    ]) assert.throws(() => rules.kitchenBody(bad), ValidationError, JSON.stringify(bad)?.slice(0, 80));
  });

  it("reads a status change: a reason for anything but active", () => {
    assert.deepEqual(rules.statusBody({ status: "active" }), { status: "active", note: null });
    assert.deepEqual(rules.statusBody({ status: "temporarily_closed", note: "Gas line repair" }), { status: "temporarily_closed", note: "Gas line repair" });
    assert.throws(() => rules.statusBody({ status: "maintenance" }), ValidationError);
    assert.throws(() => rules.statusBody({ status: "closed", note: "x x x" }), ValidationError);
    assert.throws(() => rules.statusBody({ status: "active", by: "me" }), ValidationError);
  });

  it("reads a staff member", () => {
    assert.deepEqual(rules.staffBody({ name: "Anita", phone: "9123456780", role: "chef", available: true }), { name: "Anita", phone: "9123456780", role: "chef", available: true, note: null });
    for (const bad of [{ name: "Anita", phone: "9123456780", role: "owner", available: true }, { name: "Anita", phone: "9123456780", role: "chef" }, { name: "A", phone: "9123456780", role: "chef", available: true }, { name: "Anita", phone: "9123456780", role: "chef", available: true, userId: "x" }]) {
      assert.throws(() => rules.staffBody(bad), ValidationError);
    }
  });

  it("codes, ids, days and delays", () => {
    assert.equal(rules.kitchenCode(7), "KIT-0007");
    assert.equal(rules.positiveId("12", "kitchen"), 12);
    for (const bad of ["0", "-1", "1.5", "1e3", "abc", "1 OR 1=1"]) assert.throws(() => rules.positiveId(bad, "kitchen"), ValidationError);
    const now = at("2026-11-10T13:30:00");
    assert.deepEqual(rules.dashboardQuery({}, now), { day: "2026-11-10", today: "2026-11-10", format: "xlsx" });
    assert.equal(rules.dashboardQuery({ day: "2026-11-11", format: "csv" }, now).format, "csv");
    for (const bad of [{ day: "2026-02-30" }, { day: "2028-01-01" }, { day: "today" }, { format: "pdf" }, { kitchen: "1" }]) assert.throws(() => rules.dashboardQuery(bad, now), ValidationError);
    assert.deepEqual(rules.dayBounds("2026-11-10"), { start: Date.parse("2026-11-09T18:30:00Z") / 1000, end: Date.parse("2026-11-10T18:30:00Z") / 1000 });
    const hours = week([["06:00", "14:00"], ["17:00", "22:00"]]);
    assert.equal(rules.openAt(hours, "tue", 13 * 60 + 30), true);
    assert.equal(rules.openAt(hours, "tue", 15 * 60), false);
    assert.equal(rules.openAt({ ...hours, tue: [] }, "tue", 13 * 60), false);
    const ind = rules.indiaNow(now);
    assert.deepEqual(ind, { date: "2026-11-10", minutes: 13 * 60 + 30, day: "tue" });
    assert.equal(rules.isDelayed({ status: "preparing", date: "2026-11-10", slotEndsAt: "13:00" }, ind.date, ind.minutes), true);
    assert.equal(rules.isDelayed({ status: "preparing", date: "2026-11-10", slotEndsAt: "14:00" }, ind.date, ind.minutes), false);
    assert.equal(rules.isDelayed({ status: "placed", date: "2026-11-09", slotEndsAt: "21:00" }, ind.date, ind.minutes), true);
    assert.equal(rules.isDelayed({ status: "delivered", date: "2026-11-09", slotEndsAt: "21:00" }, ind.date, ind.minutes), false);
    assert.equal(rules.isDelayed({ status: "placed", date: "2026-11-11", slotEndsAt: "09:00" }, ind.date, ind.minutes), false);
  });
});
