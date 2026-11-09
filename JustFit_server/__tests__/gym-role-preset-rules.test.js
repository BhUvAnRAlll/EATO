// Gym roles (Gym Hub ecosystem, 2026-11-10): the brief's roles as ready-made Role & Permission sets,
// how a team row reads back as a role, and that adding staff takes a known role for Staff only
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const presets = require("../gym/rolePresets");
const staffRules = require("../gym/staffRules");

describe("Gym role presets", () => {
  it("names every role of the brief", () => {
    assert.deepEqual(presets.PRESET_IDS, ["admin", "manager", "receptionist", "attendance"]);
    assert.equal(presets.ROLE_LABEL.owner, "Gym Owner");
    assert.equal(presets.ROLE_LABEL.trainer, "Trainer");
    assert.equal(presets.ROLE_LABEL.attendance, "Attendance Staff");
  });

  it("gives each role only options that exist, within their own needs", () => {
    for (const p of presets.presetList()) {
      for (const id of p.options) {
        assert.ok(staffRules.OPTION_IDS.includes(id), `${p.id}: ${id}`);
        const need = staffRules.OPTIONS.find((o) => o.id === id).needs;
        if (need) assert.ok(p.options.includes(need), `${p.id}: ${id} needs ${need}`);
      }
    }
    assert.equal(presets.presetOptions("admin"), null, "every option, now and later");
    assert.equal(presets.presetOptions("owner"), undefined, "the owner isn't a preset");
    assert.ok(!presets.presetOptions("receptionist").includes("payments.wallet"));
    assert.deepEqual(presets.presetOptions("attendance"), ["members.view", "attendance.view", "attendance.checkin"]);
  });

  it("reads a team row back as its role, or Custom once changed", () => {
    assert.equal(presets.roleOf("owner", null), "owner");
    assert.equal(presets.roleOf("trainer", null), "trainer");
    assert.equal(presets.roleOf("staff", null), "admin");
    assert.equal(presets.roleOf("staff", [...presets.presetOptions("manager")].reverse()), "manager", "order doesn't matter");
    assert.equal(presets.roleOf("staff", [...presets.presetOptions("attendance"), "sms.view"]), "custom");
  });

  it("takes a role on Add Staff for Staff only", () => {
    assert.equal(staffRules.addBody({ phone: "9845012345", kind: "staff", preset: "receptionist" }).preset, "receptionist");
    assert.throws(() => staffRules.addBody({ phone: "9845012345", kind: "trainer", preset: "receptionist" }), /role/);
    assert.throws(() => staffRules.addBody({ phone: "9845012345", kind: "staff", preset: 3 }), /role/);
    assert.equal(staffRules.addBody({ phone: "9845012345", kind: "staff" }).preset, undefined);
  });
});
