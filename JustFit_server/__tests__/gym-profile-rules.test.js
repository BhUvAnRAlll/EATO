const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/profileRules");
const gymRules = require("../gym/rules");

const closed = () => Object.fromEntries(rules.DAYS.map((d) => [d, []]));

describe("Gym public profile rules", () => {
  it("takes any of the three fields, at least one, nothing else", () => {
    assert.deepEqual(rules.profileBody({ about: "  Open since 2012.\r\n\n\n\nTwo floors.  " }), { about: "Open since 2012.\n\nTwo floors." });
    assert.deepEqual(rules.profileBody({ about: "   " }), { about: null });
    assert.deepEqual(rules.profileBody({ about: null }), { about: null });
    assert.throws(() => rules.profileBody({}), /Change the description/);
    assert.throws(() => rules.profileBody({ about: "x", gymId: 2 }), /Unexpected field: gymId/);
    assert.throws(() => rules.profileBody([]), /as an object/);
    assert.throws(() => rules.profileBody({ about: "x".repeat(501) }), /500 characters/);
    assert.throws(() => rules.profileBody({ about: 5 }), /as text/);
    assert.throws(() => rules.profileBody({ about: "bell\u0007" }), /can't show/);
    assert.deepEqual(rules.profileBody({ about: "ಕನ್ನಡ ಜಿಮ್ · हिंदी" }), { about: "ಕನ್ನಡ ಜಿಮ್ · हिंदी" });
  });

  it("keeps facilities from the list only, once each, in the list's order", () => {
    assert.deepEqual(rules.profileBody({ facilities: ["parking", "cardio", "parking"] }), { facilities: ["cardio", "parking"] });
    assert.deepEqual(rules.profileBody({ facilities: [] }), { facilities: [] });
    for (const bad of [["pool"], "cardio", [1], ["cardio' OR 1=1"], null]) assert.throws(() => rules.profileBody({ facilities: bad }), /from the list/);
  });

  it("takes every day's hours: up to two sessions, in order, open before close", () => {
    const hours = { ...closed(), mon: [["05:30", "11:00"], ["16:00", "22:00"]], sun: [["06:00", "10:00"]] };
    assert.deepEqual(rules.profileBody({ hours }).hours, hours);
    assert.deepEqual(rules.profileBody({ hours: null }), { hours: null });
    const day = (sessions) => ({ ...closed(), tue: sessions });
    assert.throws(() => rules.openingHours({ mon: [] }), /every day/);
    assert.throws(() => rules.openingHours({ ...closed(), funday: [] }), /Unexpected day/);
    assert.throws(() => rules.openingHours(day([["05:00", "06:00"], ["07:00", "08:00"], ["09:00", "10:00"]])), /up to 2/);
    for (const bad of [[["5:30", "11:00"]], [["24:00", "23:00"]], [["05:30"]], [[530, 1100]], ["05:30-11:00"]]) assert.throws(() => rules.openingHours(day(bad)), /like 05:30/);
    assert.throws(() => rules.openingHours(day([["11:00", "05:30"]])), /open before it closes/);
    assert.throws(() => rules.openingHours(day([["11:00", "11:00"]])), /open before it closes/);
    assert.throws(() => rules.openingHours(day([["05:00", "12:00"], ["11:00", "20:00"]])), /after the first/);
    assert.throws(() => rules.openingHours(day([["16:00", "20:00"], ["05:00", "09:00"]])), /after the first/);
    assert.throws(() => rules.openingHours([]), /each day/);
  });

  it("reads stored columns back safely", () => {
    assert.deepEqual(rules.readFacilities('["wifi","cardio","made-up"]'), ["cardio", "wifi"]);
    assert.deepEqual(rules.readFacilities(null), []);
    assert.deepEqual(rules.readFacilities("not json"), []);
    assert.equal(rules.readHours(null), null);
    assert.equal(rules.readHours('{"mon":[]}'), null, "half-written hours read as not given");
    const hours = { ...closed(), wed: [["06:00", "21:00"]] };
    assert.deepEqual(rules.readHours(JSON.stringify(hours)), hours);
    assert.deepEqual(rules.readHours(hours), hours, "mysql2 may hand JSON back already parsed");
  });

  it("a plan or PT package may carry details; other items may not", () => {
    assert.equal(gymRules.catalogBody({ kind: "plan", name: "Gold", duration: 3, price: 4500, details: " Steam bath included. No PT. " }, { creating: true }).details, "Steam bath included. No PT.");
    assert.equal(gymRules.catalogBody({ details: "" }, { creating: false }).details, null);
    assert.throws(() => gymRules.catalogBody({ kind: "product", name: "Whey", price: 2500, details: "1 kg" }, { creating: true }), /Only plans and PT/);
    assert.throws(() => gymRules.catalogBody({ details: "x".repeat(301) }, { creating: false }), /300 characters/);
    assert.equal(gymRules.catalogBody({ kind: "plan", name: "Gold", duration: 3, price: 4500 }, { creating: true }).details, undefined);
  });
});
