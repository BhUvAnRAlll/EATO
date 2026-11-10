// The AI Coach intake's profile answers and the targets worked out from them in code
// (coach/intakeProfile.js), and setup's personal-only save (profile.js), 2026-11-10
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { validateIntakeProfile, targetsFor, FITNESS_GOAL } = require("../coach/intakeProfile");
const { validateProfileSubmission, validateHealthFlags, validateFood } = require("../profile");

const answers = { activity: "lightly_active", healthFlags: [], diet: "vegetarian", cuisines: ["South Indian"], dislikes: "", allergies: "peanuts", mealsPerDay: "3" };
const row = { dob: "1996-04-02", gender: "female", height_cm: "165.0", weight_kg: "62.0", body_fat_percent: null };
const now = new Date("2026-11-10T06:00:00Z");

describe("intake profile answers", () => {
  it("needs an activity level, a diet and meals per day; leaves out unknown fields", () => {
    assert.equal(validateIntakeProfile(undefined), null, "older app builds send none");
    assert.deepEqual(validateIntakeProfile(answers).allergies, "peanuts");
    assert.throws(() => validateIntakeProfile({ ...answers, activity: null }), /how active/);
    assert.throws(() => validateIntakeProfile({ ...answers, diet: null }), /diet/);
    assert.throws(() => validateIntakeProfile({ ...answers, mealsPerDay: null }), /meals/);
    assert.throws(() => validateIntakeProfile({ ...answers, activity: "couch" }), /valid choice/);
    assert.throws(() => validateIntakeProfile({ ...answers, role: "admin" }), /field we don't expect/);
    assert.throws(() => validateIntakeProfile({ ...answers, healthFlags: ["flu"] }), /Unknown health/);
    assert.throws(() => validateIntakeProfile([answers]), /object/);
  });

  it("never keeps pregnancy or breastfeeding for a man", () => {
    assert.deepEqual(validateHealthFlags(["pregnant", "breastfeeding", "eating_disorder"], "male"), ["eating_disorder"]);
    assert.deepEqual(validateHealthFlags(["pregnant", "pregnant"], "female"), ["pregnant"]);
  });

  it("maps every coach goal to the calculator's", () => {
    assert.equal(FITNESS_GOAL.lose_weight, "fat_loss");
    assert.equal(FITNESS_GOAL.build_muscle, "muscle_gain");
    for (const goal of ["endurance", "stay_active", "flexibility", "sport", "comeback"]) assert.equal(FITNESS_GOAL[goal], "maintenance");
  });

  it("works the targets out with the calculator, never silently picking an equation", () => {
    const set = targetsFor(row, null, "fat_loss", answers, now);
    assert.equal(set.state, "set");
    assert.equal(set.record.active.source, "calculated");
    assert.ok(set.record.active.calories >= 1000 && set.record.active.calories <= 5000);
    assert.equal(set.record.inputs.fitnessGoal, "fat_loss");
    assert.equal(targetsFor({ ...row, gender: "unspecified" }, null, "fat_loss", answers, now).state, "needs_choice");
    assert.equal(targetsFor(row, null, "fat_loss", { ...answers, healthFlags: ["pregnant"] }, now).state, "needs_professional");
    assert.equal(targetsFor({ ...row, weight_kg: null }, null, "fat_loss", answers, now).state, "needs_details");
    assert.equal(targetsFor(row, { calculated: null }, "fat_loss", answers, now).state, "kept", "a target the member entered stays");
    const withFat = targetsFor({ ...row, body_fat_percent: "24.0" }, null, "fat_loss", answers, now);
    assert.equal(withFat.record.calculated.rmrFormula, "katch_mcardle", "a scanned body fat % uses fat-free mass");
  });
});

describe("setup's personal-only save", () => {
  const personal = { fullName: "Asha Rao", dob: "02/04/1996", gender: "female", heightCm: "165", weightKg: "62", phone: "9876543210", email: "Asha@Example.com", goal: null, activity: null, healthFlags: [], diet: null, cuisines: [], dislikes: "", allergies: "", mealsPerDay: null, bodyFatPercent: "", age: "30" };
  it("saves the personal details without targets", () => {
    const data = validateProfileSubmission({ profile: personal }, "u1");
    assert.equal(data.targets, null);
    assert.equal(data.profile.heightCm, 165);
    assert.equal(data.user.email, "asha@example.com");
    assert.equal(data.profile.goal, null);
  });
  it("still checks the personal details", () => {
    for (const [field, bad, message] of [["fullName", "A", /name/], ["dob", "31/02/2020", /Date of birth/], ["heightCm", "90", /Height/], ["weightKg", "400", /Weight/], ["email", "not-an-email", /email/], ["gender", "robot", /valid choice/]]) {
      assert.throws(() => validateProfileSubmission({ profile: { ...personal, [field]: bad } }, "u1"), message, field);
    }
    assert.throws(() => validateProfileSubmission({ profile: personal, nutrition: "x" }, "u1"), /profile, nutrition/);
  });
  it("food answers are checked like setup's", () => {
    assert.deepEqual(validateFood({ diet: "vegan", cuisines: ["  Asian  ", ""], dislikes: " okra ", allergies: "", mealsPerDay: "4" }), { diet: "vegan", cuisines: ["Asian"], dislikes: "okra", allergies: null, mealsPerDay: "4" });
    assert.throws(() => validateFood({ diet: "keto" }), /valid choice/);
  });
});
