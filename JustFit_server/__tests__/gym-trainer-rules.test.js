// A gym trainer's PT clients (gym/trainerRules.js) and the trainer fields of the gym portal's
// PT form and Change trainer (gym/rules.js ptBody, trainerBody).
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/trainerRules.js");
const gymRules = require("../gym/rules.js");
const { toE164 } = require("../auth/phone.js");

const row = (over) => ({ id: 7, member_code: "FOR-TUM-0007", full_name: "Arjun M", phone: "9123456780", photo_key: null, branch: "Tumkur", pt_label: "1 Month PT", pt_from: "2026-11-01", pt_until: "2026-11-30", in_today: 1, ...over });

describe("gym trainer rules", () => {
  it("shows PT that ended up to 30 days ago", () => {
    assert.equal(rules.ENDED_DAYS_SHOWN, 30);
    assert.equal(rules.oldestShown("2026-11-05"), "2026-10-06");
    assert.equal(rules.oldestShown("2026-03-01"), "2026-01-30");
  });

  it("describes a client with no money, only their PT and today's visit", () => {
    const client = rules.clientOf(row(), "2026-11-18", toE164);
    assert.deepEqual(client, {
      id: 7, code: "FOR-TUM-0007", name: "Arjun M", phone: "+919123456780", photoUrl: null, branch: "Tumkur",
      pt: { label: "1 Month PT", from: "2026-11-01", until: "2026-11-30", active: true, daysLeft: 12 }, inToday: true,
    });
    for (const key of ["due", "fee", "amount", "payments", "dueBy"]) assert.equal(key in client, false, key);
    assert.equal(rules.clientOf(row(), "2026-11-30", toE164).pt.active, true, "the last day still counts");
    assert.deepEqual(rules.clientOf(row(), "2026-12-05", toE164).pt, { label: "1 Month PT", from: "2026-11-01", until: "2026-11-30", active: false, daysLeft: -5 });
    assert.equal(rules.clientOf(row({ photo_key: "abcdef123456" }), "2026-11-18", toE164).photoUrl, "/api/trainer/clients/7/photo?v=abcdef12");
  });

  it("lists active PT first, the soonest to end first, then ended PT, the latest first", () => {
    const today = "2026-11-18";
    const list = [
      row({ id: 1, full_name: "Ended long ago", pt_until: "2026-11-01" }),
      row({ id: 2, full_name: "Ends later", pt_until: "2026-12-20" }),
      row({ id: 3, full_name: "Ended yesterday", pt_until: "2026-11-17" }),
      row({ id: 4, full_name: "Ends soon", pt_until: "2026-11-20" }),
    ].map((r) => rules.clientOf(r, today, toE164));
    assert.deepEqual(rules.sortClients(list).map((c) => c.id), [4, 2, 3, 1]);
  });

  it("takes an optional trainer on a PT payment: an account id, or null for none", () => {
    const base = { package: "1 Month PT", amount: 3000, method: "cash", unit: "months", duration: 1 };
    assert.equal("trainerId" in gymRules.ptBody(base), false, "left out: the member keeps their trainer");
    assert.equal(gymRules.ptBody({ ...base, trainerId: "user_Ab12" }).trainerId, "user_Ab12");
    assert.equal(gymRules.ptBody({ ...base, trainerId: null }).trainerId, null);
    for (const bad of ["", "x' OR 1=1", 5, {}, "a".repeat(65)]) assert.throws(() => gymRules.ptBody({ ...base, trainerId: bad }), /trainers/, String(bad));
  });

  it("Change trainer needs a trainer id or null, and nothing else", () => {
    assert.deepEqual(gymRules.trainerBody({ trainerId: "user_Ab12" }), { trainerId: "user_Ab12" });
    assert.deepEqual(gymRules.trainerBody({ trainerId: null }), { trainerId: null });
    assert.throws(() => gymRules.trainerBody({}), /trainers/);
    assert.throws(() => gymRules.trainerBody({ trainerId: "user_Ab12", gymId: 3 }), /fields we don't use/);
  });
});
