// Regression tests for profile persistence (profile.js): validation with a real app
// payload, tamper and ownership rejection, and transaction rollback, first with a fake
// pool (control flow) and then against real MySQL with a throwaway id inside
// transactions that are rolled back, so no row is ever left behind.
//
//   yarn test      (or: node --test "__tests__/*.test.js")
//
// The real-MySQL tests need Eato_server/.env with the application account (never root)
// and a reachable database; otherwise they are skipped and reported as such.
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const SERVER = path.join(__dirname, "..");
const ENV_FILE = path.join(SERVER, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const nutrition = require("../../Eato_client/src/lib/nutrition/index.ts");
const { validateProfileSubmission, persistProfile, loadProfile, ValidationError } = require("../profile.js");

// Throwaway identity: never a real Clerk id, never persisted (every write is rolled back)
const userId = "user_rollbacktest_" + Math.random().toString(36).slice(2, 10);
const account = { email: `${userId}@example.invalid`, role: "user" };

// A payload exactly like the targets screen builds it. The date of birth is derived
// from today so the server's age-vs-date check keeps matching inputs.age over time.
const inputs = { age: 30, gender: "male", heightCm: 175, weightKg: 70, activityLevel: "moderately_active", fitnessGoal: "fat_loss", healthFlags: [] };
const birth = new Date(); birth.setFullYear(birth.getFullYear() - inputs.age);
const pad = (n) => String(n).padStart(2, "0");
const dob = `${pad(birth.getDate())}/${pad(birth.getMonth() + 1)}/${birth.getFullYear()}`; // DD/MM/YYYY, as the app sends it
const dobIso = `${birth.getFullYear()}-${pad(birth.getMonth() + 1)}-${pad(birth.getDate())}`; // what the server stores
const result = nutrition.calculateTargets(inputs);
assert.equal(result.status, "ok");
const record = nutrition.createTargetRecord(inputs, result);
const profile = {
  fullName: "Test Person", dob, gender: "male", phone: "9876543210", email: "typed@example.invalid",
  goal: "fat_loss", heightCm: "175", weightKg: "70", bodyFatPercent: "", age: "30", activity: "moderately_active",
  healthFlags: [], diet: "vegetarian", cuisines: ["South Indian"], dislikes: "", allergies: "", workoutFrequency: "3-4",
  workoutType: "gym", workoutTime: "morning", mealsPerDay: "4",
};

describe("profile validation (no database)", () => {
  it("valid app payload passes validation and maps to rows", () => {
    const data = validateProfileSubmission({ profile, nutrition: record }, userId);
    assert.equal(data.profile.dob, dobIso);
    assert.equal(data.targets.calories, record.active.calories);
    assert.equal(data.targets.setBy, null);
    assert.equal(data.targets.reportId, null);
    assert.equal(data.user.phone, "9876543210");
  });

  it("tampered calories are rejected (400)", () => {
    const tampered = { ...record, active: { ...record.active, calories: record.active.calories + 500 } };
    assert.throws(() => validateProfileSubmission({ profile, nutrition: tampered }, userId), (e) => e instanceof ValidationError);
  });

  it("client-claimed actor is replaced by the verified user id", () => {
    const adjusted = nutrition.applyUserAdjustment(record, record.active.calories - 100, "test", "user_someoneelse");
    assert.ok(adjusted.ok);
    const data = validateProfileSubmission({ profile, nutrition: adjusted.record }, userId);
    assert.equal(data.targets.setBy, userId);
    assert.equal(data.targets.source, "user_adjusted");
  });

  it("profile numbers that disagree with the calculated inputs are rejected", () => {
    assert.throws(() => validateProfileSubmission({ profile: { ...profile, weightKg: "80" }, nutrition: record }, userId), /don't match/);
  });

  it("bad phone / dob / enum are rejected", () => {
    assert.throws(() => validateProfileSubmission({ profile: { ...profile, phone: "12345" }, nutrition: record }, userId), /10 digits/);
    assert.throws(() => validateProfileSubmission({ profile: { ...profile, dob: dobIso }, nutrition: record }, userId), /DD\/MM\/YYYY/);
    assert.throws(() => validateProfileSubmission({ profile: { ...profile, diet: "keto" }, nutrition: record }, userId), /valid choice/);
  });

  it("a report id that isn't a UUID is rejected; manual body-fat is never linked", () => {
    const manual = { ...inputs, bodyComposition: nutrition.manualBodyFatReport(70, 20) };
    const r = nutrition.calculateTargets(manual);
    assert.equal(r.status, "ok");
    const rec = nutrition.createTargetRecord(manual, r);
    const data = validateProfileSubmission({ profile: { ...profile, bodyFatPercent: "20" }, nutrition: rec }, userId);
    assert.equal(data.report, null);
    assert.equal(data.targets.reportId, null);
  });

  // Control flow only: a fake pool whose 2nd statement fails
  it("rollback (fake pool): failure after the first write rolls back, never commits, releases", async () => {
    const calls = [];
    let n = 0;
    const connection = {
      beginTransaction: async () => calls.push("begin"),
      query: async () => { n++; calls.push(`query${n}`); if (n === 2) throw new Error("boom"); return [[]]; },
      commit: async () => calls.push("commit"),
      rollback: async () => calls.push("rollback"),
      release: () => calls.push("release"),
    };
    const data = validateProfileSubmission({ profile, nutrition: record }, userId);
    await assert.rejects(persistProfile({ getConnection: async () => connection }, userId, account, data), /boom/);
    assert.deepEqual(calls, ["begin", "query1", "query2", "rollback", "release"]);
  });
});

describe("profile persistence (real MySQL, every write rolled back)", () => {
  const TABLES = ["users", "profiles", "nutrition_targets", "body_composition_reports"];
  let pool = null;
  let skipReason = null;
  let countsBefore = null;

  const rowCounts = async () => {
    const counts = {};
    for (const table of TABLES) {
      const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      counts[table] = n;
    }
    return counts;
  };
  const rowsForThrowawayId = async (table) => {
    const col = table === "users" ? "id" : "user_id";
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` = ?`, [userId]);
    return n;
  };

  before(async () => {
    if (!fs.existsSync(ENV_FILE)) { skipReason = "Eato_server/.env is missing"; return; }
    if (!process.env.DB_USER || process.env.DB_USER === "root") { skipReason = "DB_USER must be the application account, never root"; return; }
    try {
      ({ pool } = require("../database.js"));
      await pool.query("SELECT 1");
      countsBefore = await rowCounts();
    } catch (error) {
      // Only the driver's error code: never a message that could carry connection details
      skipReason = `database unreachable (${error?.code ?? "unknown"})`;
      if (pool) { await pool.end().catch(() => {}); pool = null; }
    }
  });

  after(async () => {
    if (pool) await pool.end();
  });

  // users insert succeeds, profiles insert violates a CHECK (body fat 90 bypasses JS
  // validation by editing the validated rows), so the transaction must roll back
  it("rollback (real MySQL): CHECK violation on the 2nd statement leaves zero rows", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const data = validateProfileSubmission({ profile, nutrition: record }, userId);
    data.profile.bodyFatPercent = 90; // profiles.chk_profiles_body_fat is 2..75
    await assert.rejects(persistProfile(pool, userId, account, data), (e) => e.code === "ER_CHECK_CONSTRAINT_VIOLATED");
    for (const table of TABLES) assert.equal(await rowsForThrowawayId(table), 0, `${table} should have no row for the throwaway id`);
  });

  it("rollback (real MySQL): FK violation on the last statement (report_id → missing report) leaves zero rows", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const data = validateProfileSubmission({ profile, nutrition: record }, userId);
    data.targets.reportId = "00000000-0000-4000-8000-000000000000"; // no such report row
    await assert.rejects(persistProfile(pool, userId, account, data), (e) => e.code === "ER_NO_REFERENCED_ROW_2");
    for (const table of ["users", "profiles", "nutrition_targets"]) assert.equal(await rowsForThrowawayId(table), 0, `${table} should have no row for the throwaway id`);
  });

  it("loadProfile for an unknown user returns nulls (no row ever written)", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.deepEqual(await loadProfile(pool, userId), { profile: null, nutrition: null });
  });

  it("database row counts are unchanged by the test run", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.deepEqual(await rowCounts(), countsBefore);
  });
});
