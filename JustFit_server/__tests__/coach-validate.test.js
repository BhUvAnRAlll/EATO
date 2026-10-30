// AI Coach intake checks (coach/validate.js): pure functions, no database.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { validateIntake, prefillFrom, limits } = require("../coach/validate.js");
const { ValidationError } = require("../profile.js");

const answers = (over = {}) => ({
  goal: "lose_weight",
  experience: "beginner",
  currentlyTraining: false,
  weekdays: [5, 1, 3],
  sessionMinutes: 45,
  mainSpot: "home",
  backupSpot: "gym",
  mainEquipment: "none",
  backupEquipment: "full_gym",
  joints: ["knees", "wrists", "knees"],
  conditions: [],
  limitationNotes: "  Torn ACL\nin 2023 ",
  cookingTime: "quick",
  foodBudget: "medium",
  stress: null,
  sleep: "7_8",
  coach: "priya",
  coachStyle: "supportive",
  planNotes: "",
  acceptedDisclaimer: true,
  ...over,
});
const refuses = (body, pattern) => assert.throws(() => validateIntake(body), (error) => error instanceof ValidationError && pattern.test(error.message));

describe("AI Coach intake checks (server)", () => {
  it("accepts a full set of answers and tidies them", () => {
    const clean = validateIntake(answers());
    assert.deepEqual(clean.weekdays, [1, 3, 5]);
    assert.deepEqual(clean.joints, ["knees", "wrists"]);
    assert.equal(clean.limitationNotes, "Torn ACL in 2023");
    assert.equal(clean.planNotes, null);
    assert.equal("acceptedDisclaimer" in clean, false);
  });

  it("needs the disclaimer ticked", () => {
    refuses(answers({ acceptedDisclaimer: false }), /not medical advice/);
    refuses(answers({ acceptedDisclaimer: "true" }), /not medical advice/);
  });

  it("refuses unknown options, bad days and unexpected fields", () => {
    refuses(answers({ goal: "fly" }), /goal/);
    refuses(answers({ coach: "Robert'); DROP TABLE users;--" }), /coach/);
    refuses(answers({ sessionMinutes: 50 }), /session length/);
    refuses(answers({ weekdays: [] }), /training day/);
    refuses(answers({ weekdays: [7] }), /training day/);
    refuses(answers({ weekdays: [0, 1, 2, 3, 4, 5, 6, 0] }), /training day/);
    refuses(answers({ joints: ["neck"] }), /joints/);
    refuses(answers({ conditions: "diabetes" }), /conditions/);
    refuses(answers({ currentlyTraining: "no" }), /working out/);
    refuses(answers({ userId: "user_someone_else" }), /unexpected field: userId/);
    for (const body of [null, [], "x"]) refuses(body, /object/);
  });

  it("matches equipment to the spot", () => {
    refuses(answers({ mainSpot: "gym", mainEquipment: "none" }), /main spot/);
    refuses(answers({ backupSpot: "home", backupEquipment: "basic_gym" }), /backup spot/);
    refuses(answers({ backupSpot: "home", mainSpot: "home" }), /different/);
    refuses(answers({ backupSpot: null, backupEquipment: "some" }), /no backup spot/);
    assert.equal(validateIntake(answers({ backupSpot: null, backupEquipment: null })).backupEquipment, null);
  });

  it("cuts long notes and refuses non-text", () => {
    assert.equal(validateIntake(answers({ planNotes: "a".repeat(900) })).planNotes.length, limits.planNotes);
    refuses(answers({ limitationNotes: 5 }), /text/);
  });
});

describe("AI Coach prefill (server)", () => {
  it("starts from what setup and the workout profile already know", () => {
    assert.deepEqual(prefillFrom({ goal: "muscle_gain", workout_type: "gym" }, { experience: "intermediate", weekdays: "[5,1,3]" }), {
      goal: "build_muscle", mainSpot: "gym", experience: "intermediate", weekdays: [1, 3, 5],
    });
  });

  it("leaves out anything missing or unknown", () => {
    assert.deepEqual(prefillFrom(undefined, undefined), {});
    assert.deepEqual(prefillFrom({ goal: null, workout_type: "other" }, { experience: null, weekdays: [9] }), {});
  });
});
