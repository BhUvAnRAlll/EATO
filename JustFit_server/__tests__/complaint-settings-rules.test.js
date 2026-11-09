// Complaints about gyms and platform settings (Gym Hub ecosystem, section 7): what a member reports,
// how admins move a case, and the justFit-wide defaults
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const complaints = require("../complaints/rules");
const settings = require("../platform/settingsRules");

describe("Complaint rules", () => {
  it("takes a report with a known category and enough words", () => {
    const out = complaints.reportBody({ gymId: 4, category: "safety", details: "The treadmill belt snapped while I was running on it." });
    assert.equal(out.category, "safety");
    assert.throws(() => complaints.reportBody({ gymId: 4, category: "safety", details: "Bad." }), /20 characters/);
    assert.throws(() => complaints.reportBody({ gymId: 4, category: "spam", details: "x".repeat(30) }), /Pick what/);
    assert.throws(() => complaints.reportBody({ gymId: "4", category: "safety", details: "x".repeat(30) }), /gym/);
    assert.throws(() => complaints.reportBody({ gymId: 4, category: "safety", details: "x".repeat(30), status: "resolved" }), /fields/);
  });

  it("needs words for the member when a case closes, and moves sensibly", () => {
    assert.throws(() => complaints.statusBody({ status: "resolved" }), /member is told/);
    assert.deepEqual(complaints.statusBody({ status: "investigating" }), { status: "investigating", resolution: null });
    assert.equal(complaints.statusBody({ status: "dismissed", resolution: "We checked and the gym was not at fault." }).status, "dismissed");
    assert.equal(complaints.moveProblem("open", "investigating"), null);
    assert.equal(complaints.moveProblem("resolved", "open"), null);
    assert.match(complaints.moveProblem("open", "open"), /already/);
    assert.match(complaints.moveProblem("investigating", "open"), /closed/);
    assert.deepEqual(complaints.statusesFor("active"), ["open", "investigating"]);
    assert.throws(() => complaints.listQuery({ status: "deleted" }), /Pick/);
  });
});

describe("Platform settings rules", () => {
  it("reads stored settings over the defaults", () => {
    assert.deepEqual(settings.read([]), settings.DEFAULTS);
    const out = settings.read([{ setting_key: "registrationOpen", value: "false" }, { setting_key: "requiredDocuments", value: ["address", "registration"] }]);
    assert.equal(out.registrationOpen, false);
    assert.deepEqual(out.requiredDocuments, ["registration", "address"]);
    assert.equal(settings.read([{ setting_key: "registrationOpen", value: "not json" }]).registrationOpen, true);
  });

  it("checks each setting", () => {
    assert.deepEqual(settings.settingsBody({ registrationOpen: false }), { registrationOpen: false });
    assert.deepEqual(settings.settingsBody({ pausePolicy: { maxPerYear: 2 } }).pausePolicy, { maxPerYear: 2, maxDaysPerYear: null, maxDaysEach: 90 });
    assert.deepEqual(settings.settingsBody({ crowdThresholds: { moderate: 30, busy: 60, veryBusy: 85 } }).crowdThresholds, { moderate: 30, busy: 60, veryBusy: 85 });
    assert.throws(() => settings.settingsBody({ registrationOpen: "yes" }), /on or off/);
    assert.throws(() => settings.settingsBody({ requiredDocuments: ["passport"] }), /list/);
    assert.throws(() => settings.settingsBody({ crowdThresholds: { moderate: 80, busy: 60, veryBusy: 90 } }), /rising/);
    assert.throws(() => settings.settingsBody({ adminPassword: "x" }), /settings we don't use/);
    assert.throws(() => settings.settingsBody({}), /at least one/);
  });
});
