// The gym portal's SMS rules and sender (gym/smsRules.js, gym/smsSender.js): the messages, the
// once-only keys, the daytime window, the checks on what the app sends, and the provider set-up.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rules = require("../gym/smsRules");
const { createGymSmsSender } = require("../gym/smsSender");
const { ValidationError } = require("../profile");

const gym = { brand: "Forma", branch: "Tumkur" };
const member = { full_name: "Priya Sharma", expires_on: "2026-11-30", due_amount: 1500, member_code: "FOR-TUM-0001" };

describe("gym SMS messages", () => {
  it("fills each template with the member's values, in the DLT order", () => {
    assert.deepEqual(rules.variablesFor("expiry", member, gym), ["Priya", "Forma Tumkur", "30 Nov 2026"]);
    assert.equal(rules.render("expiry", rules.variablesFor("expiry", member, gym)), "Hi Priya, your membership at Forma Tumkur ends on 30 Nov 2026. Renew to keep training with us. - justFit");
    assert.deepEqual(rules.variablesFor("due", member, gym), ["Priya", "1,500", "Forma Tumkur", "FOR-TUM-0001"]);
    assert.match(rules.render("due", rules.variablesFor("due", member, gym)), /Rs 1,500 is due at Forma Tumkur for membership FOR-TUM-0001/);
    assert.equal(rules.render("birthday", rules.variablesFor("birthday", member, gym)), "Happy birthday Priya! Wishing you a great year of health and strength from all of us at Forma Tumkur. - justFit");
  });

  it("keeps every variable within DLT's 30 characters", () => {
    const long = { ...member, full_name: "A".repeat(80) };
    const values = rules.variablesFor("expiry", long, { brand: "B".repeat(40), branch: "C".repeat(40) });
    for (const value of values) assert.ok(value.length <= rules.MAX_VAR);
  });

  it("has a template, an auto row and a preview for every kind", () => {
    for (const kind of rules.KINDS) {
      assert.ok(rules.TEMPLATES[kind] && rules.AUTO[kind]);
      assert.equal((rules.TEMPLATES[kind].text.match(/\{[a-z]+\}/g) ?? []).length, rules.TEMPLATES[kind].vars.length);
      assert.match(rules.preview(kind, gym, "2026-11-04"), /Priya/);
    }
    for (const group of Object.values(rules.GROUPS)) assert.ok(rules.KINDS.includes(group.kind));
  });
});

describe("gym SMS once-only keys and timing", () => {
  it("keys expiry reminders by the plan's end, dues by week, birthdays by year", () => {
    assert.equal(rules.autoKey("expiry", member, "2026-11-29"), "expiry:2026-11-30");
    assert.equal(rules.autoKey("expired", member, "2026-12-03"), "expired:2026-11-30");
    assert.equal(rules.autoKey("due", member, "2026-11-04"), "due:2026-11-02"); // a Wednesday → Monday
    assert.equal(rules.autoKey("due", member, "2026-11-08"), "due:2026-11-02"); // Sunday, same week
    assert.equal(rules.autoKey("due", member, "2026-11-09"), "due:2026-11-09");
    assert.equal(rules.autoKey("birthday", member, "2026-05-01"), "birthday:2026");
  });

  it("sends auto reminders between 10:00 and 19:59 India time only", () => {
    const ist = (h) => Date.UTC(2026, 10, 4, h, 0) - 330 * 60 * 1000;
    assert.equal(rules.reminderHour(ist(9)), false);
    assert.equal(rules.reminderHour(ist(10)), true);
    assert.equal(rules.reminderHour(ist(19)), true);
    assert.equal(rules.reminderHour(ist(20)), false);
  });
});

describe("gym SMS request checks", () => {
  it("accepts switch changes and refuses anything else", () => {
    assert.deepEqual(rules.settingsBody({ expiry: true, birthday: false }), { expiry: true, birthday: false });
    for (const bad of [null, [], {}, { expiry: "yes" }, { gym_id: true }, { expiry: 1 }]) assert.throws(() => rules.settingsBody(bad), ValidationError);
  });

  it("accepts a known group and kind only", () => {
    assert.deepEqual(rules.sendBody({ group: "due" }), { group: "due" });
    for (const bad of [{}, { group: "all" }, { group: "due", gymId: 2 }, { group: "__proto__" }, { group: "due' OR 1=1 --" }]) assert.throws(() => rules.sendBody(bad), ValidationError);
    assert.deepEqual(rules.memberSmsBody({ kind: "expired" }), { kind: "expired" });
    for (const bad of [{}, { kind: "manual" }, { kind: "due", phone: "9999999999" }]) assert.throws(() => rules.memberSmsBody(bad), ValidationError);
  });

  it("pages logs by id and checks credits", () => {
    assert.deepEqual(rules.logsQuery({}), { before: null });
    assert.deepEqual(rules.logsQuery({ before: "42" }), { before: 42 });
    for (const bad of [{ before: "0" }, { before: "1;DROP" }, { before: ["1"] }, { page: "2" }]) assert.throws(() => rules.logsQuery(bad), ValidationError);
    assert.deepEqual(rules.creditsBody({ credits: 500 }), { credits: 500 });
    for (const bad of [{ credits: 0 }, { credits: 100001 }, { credits: 1.5 }, { credits: "500" }, { credits: 5, gym: 1 }]) assert.throws(() => rules.creditsBody(bad), ValidationError);
  });
});

describe("gym SMS sender", () => {
  const keys = { FAST2SMS_API_KEY: "test-key", FAST2SMS_SENDER_ID: "JSTFIT", FAST2SMS_GYM_EXPIRY_ID: "101", FAST2SMS_GYM_EXPIRED_ID: "102", FAST2SMS_GYM_DUE_ID: "103", FAST2SMS_GYM_BIRTHDAY_ID: "104" };

  it("is off unless a provider and every template are set", () => {
    assert.equal(createGymSmsSender({}).enabled, false);
    assert.equal(createGymSmsSender({ SMS_PROVIDER: "fast2sms", ...keys, FAST2SMS_GYM_DUE_ID: "" }).enabled, false);
    assert.equal(createGymSmsSender({ SMS_PROVIDER: "fake", NODE_ENV: "production", DB_NAME: "justfit" }).enabled, false);
    assert.equal(createGymSmsSender({ SMS_PROVIDER: "fast2sms", ...keys }).enabled, true);
  });

  it("posts the DLT template and variables to Fast2SMS and reports only the status", async () => {
    const calls = [];
    const ok = createGymSmsSender({ SMS_PROVIDER: "fast2sms", ...keys }, { fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ return: true }) }; } });
    await ok.send("9876543210", "due", ["Priya", "1,500", "Forma|Tumkur", "FOR-TUM-0001"]);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, { route: "dlt", sender_id: "JSTFIT", message: "103", variables_values: "Priya|1,500|Forma/Tumkur|FOR-TUM-0001", numbers: "9876543210" });
    assert.equal(calls[0].init.headers.authorization, "test-key");
    const failing = createGymSmsSender({ SMS_PROVIDER: "fast2sms", ...keys }, { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ return: false, status_code: 412 }) }) });
    await assert.rejects(failing.send("9876543210", "due", []), (error) => error.reason === "412" && !/9876543210|test-key/.test(error.message));
  });

  it("writes to the fake outbox in tests and fails on request", async () => {
    const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-gym-sms-"));
    const fake = createGymSmsSender({ SMS_PROVIDER: "fake", NODE_ENV: "test", DB_NAME: "justfit_test", SMS_FAKE_OUTBOX: outbox });
    await fake.send("9876543210", "birthday", ["Priya", "Forma Tumkur"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outbox, "gym-sms.jsonl"), "utf8")).values, ["Priya", "Forma Tumkur"]);
    fs.writeFileSync(path.join(outbox, "fail-9000000000"), "");
    await assert.rejects(fake.send("9000000000", "due", []));
    fs.rmSync(outbox, { recursive: true, force: true });
  });
});
