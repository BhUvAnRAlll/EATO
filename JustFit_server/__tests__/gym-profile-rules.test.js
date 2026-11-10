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
    assert.throws(() => rules.profileBody({}), /Change something/);
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

describe("Gym Profile Management rules (2026-11-09)", () => {
  const today = "2026-11-09";
  const row = (extra = {}) => ({ about: "Two floors.", facilities: ["cardio"], opening_hours: { ...closed(), mon: [["06:00", "10:00"]] }, address: "12 MG Road", phone: "9876543210", latitude: null, ...extra });

  it("takes contacts and links: WhatsApp numbers, emails and https links on the right sites", () => {
    assert.deepEqual(rules.profileBody({ whatsapp: "+91 98765 43210", email: " Desk@Forma.IN " }, today), { whatsapp: "9876543210", email: "desk@forma.in" });
    assert.deepEqual(rules.profileBody({ whatsapp: "", website: "", instagram: null }, today), { whatsapp: null, website: null, instagram: null });
    assert.equal(rules.profileBody({ website: "forma.in/tumkur" }, today).website, "https://forma.in/tumkur");
    assert.equal(rules.profileBody({ instagram: "instagram.com/forma.fit" }, today).instagram, "https://instagram.com/forma.fit");
    assert.equal(rules.profileBody({ facebook: "http://m.facebook.com/forma" }, today).facebook, "https://m.facebook.com/forma");
    assert.throws(() => rules.profileBody({ instagram: "https://evil.example/forma" }, today), /instagram.com/);
    assert.throws(() => rules.profileBody({ website: "javascript:alert(1)" }, today), /look right/);
    assert.throws(() => rules.profileBody({ website: "ftp://forma.in" }, today), /https/);
    assert.throws(() => rules.profileBody({ website: "https://user:pw@forma.in" }, today), /doesn't look right/);
    assert.throws(() => rules.profileBody({ website: `https://forma.in/${"a".repeat(200)}` }, today), /200 characters/);
    assert.throws(() => rules.profileBody({ email: "not-an-email" }, today), /email/);
    assert.throws(() => rules.profileBody({ whatsapp: "12345" }, today), /10-digit/);
  });

  it("takes the gym's own facilities, once each, never a listed one", () => {
    assert.deepEqual(rules.profileBody({ custom: [{ name: "  Boxing   ring ", on: true }, { name: "Crèche", on: false }] }, today).custom, [{ name: "Boxing ring", on: true }, { name: "Crèche", on: false }]);
    assert.throws(() => rules.profileBody({ custom: [{ name: "Parking", on: true }] }, today), /already on the list/);
    assert.throws(() => rules.profileBody({ custom: [{ name: "Pool", on: true }, { name: "pool", on: true }] }, today), /twice/);
    assert.throws(() => rules.profileBody({ custom: [{ name: "P", on: true }] }, today), /2 to 40/);
    assert.throws(() => rules.profileBody({ custom: [{ name: "Pool", on: "yes" }] }, today), /on or off/);
    assert.throws(() => rules.profileBody({ custom: [{ name: "Pool", on: true, id: 3 }] }, today), /name and on or off/);
    assert.throws(() => rules.profileBody({ custom: Array.from({ length: 11 }, (_, i) => ({ name: `Thing ${i}`, on: true })) }, today), /up to 10/);
  });

  it("takes closures from today to a year ahead, once each, sorted", () => {
    assert.deepEqual(rules.profileBody({ closures: [{ date: "2026-12-25", note: "Christmas" }, { date: "2026-11-09", note: "" }] }, today).closures, [{ date: "2026-11-09", note: null }, { date: "2026-12-25", note: "Christmas" }]);
    assert.throws(() => rules.profileBody({ closures: [{ date: "2026-11-08", note: null }] }, today), /today to a year/);
    assert.throws(() => rules.profileBody({ closures: [{ date: "2027-11-10", note: null }] }, today), /today to a year/);
    assert.throws(() => rules.profileBody({ closures: [{ date: "2026-02-30", note: null }] }, today), /date/);
    assert.throws(() => rules.profileBody({ closures: [{ date: "2026-12-25" }, { date: "2026-12-25" }] }, today), /twice/);
  });

  it("switches sections on and off: every section answered, unknown ones refused", () => {
    const show = rules.profileBody({ show: { pt: false, links: false } }, today).show;
    assert.equal(show.pt, false);
    assert.equal(show.links, false);
    assert.equal(show.photos, true);
    assert.deepEqual(Object.keys(show), rules.SECTIONS);
    assert.throws(() => rules.profileBody({ show: { members: true } }, today), /Unexpected section/);
    assert.throws(() => rules.profileBody({ show: { pt: "no" } }, today), /on or off/);
  });

  it("reorders photos only with every one of the branch's photos, once", () => {
    assert.deepEqual(rules.photoOrder({ ids: [3, 1, 2] }, [1, 2, 3]), [3, 1, 2]);
    assert.throws(() => rules.photoOrder({ ids: [1, 2] }, [1, 2, 3]), /every photo/);
    assert.throws(() => rules.photoOrder({ ids: [1, 2, 9] }, [1, 2, 3]), /every photo/);
    assert.throws(() => rules.photoOrder({ ids: [1, 1, 2] }, [1, 2, 3]), /every photo/);
    assert.throws(() => rules.photoOrder({ ids: [1, 2, 3], gymId: 4 }, [1, 2, 3]), /Unexpected field/);
  });

  it("builds the draft copy, compares it with the published one and checks what Publish needs", () => {
    const draft = rules.snapshot(row({ custom_facilities: [{ name: "Boxing ring", on: true }, { name: "Crèche", on: false }] }), [5, 4], today);
    assert.deepEqual(draft.custom, ["Boxing ring"]);
    assert.deepEqual(draft.photos, [5, 4]);
    assert.equal(rules.publishState(draft, null), "draft");
    const published = rules.readPublished(JSON.stringify(draft), [5, 4], today);
    assert.equal(rules.publishState(draft, published), "published");
    assert.equal(rules.publishState({ ...draft, about: "New" }, published), "changed");
    // A photo deleted since publishing is gone from both: no "changed"
    assert.equal(rules.publishState(rules.snapshot(row({ custom_facilities: [{ name: "Boxing ring", on: true }] }), [5], today), rules.readPublished(JSON.stringify(draft), [5], today)), "published");
    // A closure that has passed drops off both
    const withClosure = rules.snapshot(row({ closures: [{ date: "2026-11-10", note: null }] }), [], today);
    assert.equal(rules.readPublished(JSON.stringify(withClosure), [], "2026-11-11").closures.length, 0);
    // The migration's copy (photos and show null): the gallery as it is, every section on
    const migrated = rules.readPublished({ about: "x", facilities: [], custom: [], hours: null, closures: [], contact: {}, photos: null, show: null }, [7, 8], today);
    assert.deepEqual(migrated.photos, [7, 8]);
    assert.equal(migrated.show.plans, true);

    const list = rules.checklist(draft, { hasLocation: false });
    assert.equal(rules.publishProblem(list), null);
    const empty = rules.snapshot({}, [], today);
    assert.match(rules.publishProblem(rules.checklist(empty, { hasLocation: false })), /a description, at least one photo, opening hours, a phone or whatsapp number, the address/);
    assert.equal(rules.checklist({ ...empty, about: "x", photos: [1], hours: draft.hours, contact: { ...empty.contact, whatsapp: "9876543210" } }, { hasLocation: true }).every((i) => !i.required || i.done), true);
  });

  it("leaves switched-off sections out of what members get", () => {
    const draft = rules.snapshot(row({ whatsapp: "9876543210", website: "https://forma.in/", profile_show: { contact: false, links: false, photos: false, plans: false, address: false } }), [1], today);
    const seen = rules.forMembers(draft);
    assert.equal(seen.contact.phone, null);
    assert.equal(seen.contact.whatsapp, null);
    assert.equal(seen.contact.website, null);
    assert.equal(seen.contact.address, null);
    assert.equal(seen.showLocation, false);
    assert.deepEqual(seen.photos, []);
    assert.equal(seen.showPlans, false);
    assert.equal(seen.showPt, true);
    assert.equal(seen.about, "Two floors.");
  });
});

describe("Kind of gym (G16)", () => {
  it("takes up to three kinds from the list, in the list's order", () => {
    assert.deepEqual(rules.profileBody({ types: ["yoga", "gym"] }, "2026-11-10"), { types: ["gym", "yoga"] });
    assert.deepEqual(rules.profileBody({ types: [] }, "2026-11-10"), { types: [] });
    assert.throws(() => rules.profileBody({ types: ["gym", "yoga", "dance", "women"] }, "2026-11-10"), /up to 3/);
    assert.throws(() => rules.profileBody({ types: ["swimming"] }, "2026-11-10"), /from the list/);
    assert.throws(() => rules.profileBody({ types: "gym" }, "2026-11-10"), /from the list/);
  });

  it("publishes with the profile; an older published copy reads as none and stays published", () => {
    const row = { about: "Two floors.", gym_types: '["women","gym"]', facilities: "[]" };
    const draft = rules.snapshot(row, [], "2026-11-10");
    assert.deepEqual(draft.types, ["gym", "women"]);
    const published = rules.readPublished(JSON.stringify(draft), [], "2026-11-10");
    assert.equal(rules.publishState(draft, published), "published");
    const before = rules.snapshot({ about: "Two floors.", facilities: "[]" }, [], "2026-11-10");
    const { types, ...older } = before;
    assert.deepEqual(types, []);
    assert.equal(rules.publishState(before, rules.readPublished(JSON.stringify(older), [], "2026-11-10")), "published");
    assert.deepEqual(rules.readTypes('["swimming","yoga"]'), ["yoga"]);
    const seen = rules.forMembers({ ...draft, show: { ...draft.show, about: false } });
    assert.deepEqual(seen.types, ["gym", "women"], "always shown");
  });
});
