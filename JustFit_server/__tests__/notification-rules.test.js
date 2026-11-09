// In-app notifications (Gym Hub ecosystem, section 9): building one (its category, short words, a link
// only to a known screen, a dedupe key per event) and what a person may send to read or mute them
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../notifications/rules");

describe("Notification rules", () => {
  it("builds a notification with its category, a safe link and a dedupe key", () => {
    const n = rules.build({ kind: "pause.approved", key: "12", title: "Pause approved", body: "Your pause is approved.", link: "/gym-hub/4" });
    assert.deepEqual(n, { kind: "pause.approved", category: "pauses", title: "Pause approved", body: "Your pause is approved.", link: "/gym-hub/4", key: "pause.approved:12" });
    assert.equal(rules.build({ kind: "gym.capacity", key: "1", title: "t", body: "b" }).category, "attendance");
    assert.throws(() => rules.build({ kind: "made.up", key: "1", title: "t", body: "b" }), /Unknown/);
    assert.throws(() => rules.build({ kind: "pause.approved", title: "t", body: "b" }), /dedupe/);
    assert.equal(rules.build({ kind: "pause.approved", key: "1", title: "t".repeat(300), body: "b" }).title.length, 120);
  });

  it("only links to screens on the list", () => {
    for (const ok of ["/gym-hub", "/gym-hub/12", "/gym/pauses", "/gym/members/3", "/admin/gyms/7", "/gym-register", "/gym"]) assert.equal(rules.safeLink(ok), ok);
    for (const bad of ["https://evil.example", "/gym-hub/../admin", "/admin/users", "javascript:alert(1)", "//evil", "/gym/pauses?x=1", 7]) assert.equal(rules.safeLink(bad), null, String(bad));
  });

  it("checks what a person sends", () => {
    assert.deepEqual(rules.preferencesBody({ muted: ["attendance", "gym", "attendance"] }), { muted: ["attendance", "gym"] });
    assert.throws(() => rules.preferencesBody({ muted: ["spam"] }), /categories/);
    assert.throws(() => rules.preferencesBody({ muted: [], userId: "x" }), /fields/);
    assert.deepEqual(rules.readBody({ all: true }), { all: true });
    assert.deepEqual(rules.readBody({ ids: [3, 3, 4] }), { ids: [3, 4] });
    assert.throws(() => rules.readBody({ ids: ["1 OR 1=1"] }), /Pick/);
    assert.throws(() => rules.readBody({ ids: [] }), /Pick/);
    assert.throws(() => rules.listQuery({ page: "0" }), /page/);
    assert.deepEqual(rules.readMuted("not json"), []);
  });
});
