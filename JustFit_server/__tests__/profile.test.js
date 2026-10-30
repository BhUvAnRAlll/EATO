// Regression tests for profile persistence (profile.js): validation with a real app
// payload, tamper and ownership rejection, and transaction rollback, first with a fake
// pool (control flow) and then against the eato_test database with a throwaway account
// whose failed saves are rolled back; the account itself is deleted afterwards.
//
//   yarn test      (or: node --test "__tests__/*.test.js")
//
// The real-MySQL tests need JustFit_server/.env.test (eato_test only, never the app database)
// with the current schema (npm run test:e2e rebuilds it); otherwise they are skipped and
// reported as such.
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const mysql = require("mysql2/promise");
const testDb = require("./e2e/test-db.js");

const nutrition = require("../../JustFit_client/src/lib/nutrition/index.ts");
const { validateProfileSubmission, persistProfile, loadProfile, ValidationError } = require("../profile.js");

// Throwaway account in eato_test: created before the real-MySQL tests, deleted after them
const userId = "user_rollbacktest" + Math.random().toString(36).slice(2, 10);

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
      query: async () => { n++; calls.push(`query${n}`); if (n === 2) throw new Error("boom"); return n === 1 ? [{ affectedRows: 1 }] : [[]]; },
      commit: async () => calls.push("commit"),
      rollback: async () => calls.push("rollback"),
      release: () => calls.push("release"),
    };
    const data = validateProfileSubmission({ profile, nutrition: record }, userId);
    await assert.rejects(persistProfile({ getConnection: async () => connection }, userId, data), /boom/);
    assert.deepEqual(calls, ["begin", "query1", "query2", "rollback", "release"]);
  });
});

describe("profile persistence (eato_test, failed saves rolled back)", () => {
  const TABLES = ["users", "profiles", "nutrition_targets", "body_composition_reports"];
  const PHONE = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
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
  const accountRow = async () => (await pool.query("SELECT full_name, phone, email, role FROM users WHERE id = ?", [userId]))[0][0];
  const removeAccount = async () => {
    for (const table of ["nutrition_targets", "body_composition_reports", "profiles", "users"]) {
      await pool.query(`DELETE FROM \`${table}\` WHERE \`${table === "users" ? "id" : "user_id"}\` = ?`, [userId]);
    }
  };

  before(async () => {
    const loaded = testDb.loadTestEnv(); // refuses anything but eato_test
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    const env = loaded.env;
    try {
      pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectionLimit: 2, decimalNumbers: true });
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_verified_at'");
      if (n === 0) { skipReason = "eato_test has an older schema (npm run test:e2e rebuilds it from schema.sql)"; return; }
      countsBefore = await rowCounts();
      // The account phone sign-in would have made: verified phone, no email, no name yet
      await pool.query("INSERT INTO users (id, email, full_name, phone, phone_verified_at, role) VALUES (?, NULL, NULL, ?, NOW(), 'user')", [userId, PHONE]);
    } catch (error) {
      // Only the driver's error code: never a message that could carry connection details
      skipReason = `eato_test unreachable (${error?.code ?? "unknown"})`;
    }
  });

  after(async () => {
    if (!pool) return;
    if (countsBefore) await removeAccount().catch(() => {});
    await pool.end();
  });

  // The users update succeeds, the profiles insert violates a CHECK (body fat 90 bypasses JS
  // validation by editing the validated rows), so the whole transaction must roll back
  it("rollback (MySQL): CHECK violation on the 2nd statement leaves the account as it was and no profile rows", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const data = validateProfileSubmission({ profile, nutrition: record }, userId);
    data.profile.bodyFatPercent = 90; // profiles.chk_profiles_body_fat is 2..75
    await assert.rejects(persistProfile(pool, userId, data), (e) => e.code === "ER_CHECK_CONSTRAINT_VIOLATED");
    assert.equal((await accountRow()).full_name, null, "the name update must be rolled back too");
    for (const table of ["profiles", "nutrition_targets", "body_composition_reports"]) assert.equal(await rowsForThrowawayId(table), 0, `${table} should have no row for the throwaway id`);
  });

  it("rollback (MySQL): FK violation on the last statement (report_id → missing report) leaves no profile rows", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const data = validateProfileSubmission({ profile, nutrition: record }, userId);
    data.targets.reportId = "00000000-0000-4000-8000-000000000000"; // no such report row
    await assert.rejects(persistProfile(pool, userId, data), (e) => e.code === "ER_NO_REFERENCED_ROW_2");
    assert.equal((await accountRow()).full_name, null);
    for (const table of ["profiles", "nutrition_targets"]) assert.equal(await rowsForThrowawayId(table), 0, `${table} should have no row for the throwaway id`);
  });

  it("a save keeps the verified phone and never writes email or role", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const data = validateProfileSubmission({ profile: { ...profile, phone: "9000000001" }, nutrition: record }, userId);
    await persistProfile(pool, userId, data);
    const row = await accountRow();
    assert.equal(row.phone, PHONE, "the phone proved at sign-in can't be changed from the form");
    assert.equal(row.email, null);
    assert.equal(row.role, "user");
    assert.equal(row.full_name, data.user.fullName);
  });

  it("a save for an account that doesn't exist is refused (401) and writes nothing", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const ghost = "user_noaccount" + Math.random().toString(36).slice(2, 12);
    const data = validateProfileSubmission({ profile, nutrition: record }, ghost);
    await assert.rejects(persistProfile(pool, ghost, data), (e) => e.status === 401);
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?", [ghost]);
    assert.equal(n, 0);
  });

  it("loadProfile for an unknown user returns nulls (no row ever written)", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.deepEqual(await loadProfile(pool, "user_unknown" + Math.random().toString(36).slice(2, 12)), { profile: null, nutrition: null });
  });

  it("row counts are back to where they started once the throwaway account is removed", async (t) => {
    if (skipReason) return t.skip(skipReason);
    await removeAccount();
    assert.deepEqual(await rowCounts(), countsBefore);
  });
});
