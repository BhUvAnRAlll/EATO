// Unit tests for the trainer input checks (trainers/validate.js): no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const v = require("../trainers/validate.js");

const rejects = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));
const UUID = "11111111-2222-4333-8444-555555555555";
const food = (over = {}) => ({ name: "Oats", quantity: 60, unit: "g", kcal: 230, proteinG: 8, carbsG: 40, fatG: 4, ...over });
const meal = (slot, over = {}) => ({ slot, name: `${slot} meal`, time: "08:00", items: [food()], ...over });
const plan = (over = {}) => ({ name: "Lean phase", goal: "fat_loss", startDate: "2026-10-20", meals: ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"].map((s) => meal(s)), ...over });
const exercise = (over = {}) => ({ exerciseId: UUID, sets: [{ reps: 8 }, { reps: 8 }], restSec: 90, ...over });
const workout = (over = {}) => ({ name: "Upper/lower", goal: "build_muscle", level: "intermediate", days: [{ weekday: 1, title: "Upper", exercises: [exercise()] }], ...over });

describe("trainer validation", () => {
  it("the trainer profile: a title, a bio, known specialties, booleans and lists within limits", () => {
    const profile = v.validateTrainerProfile({ title: "Strength coach", specialties: ["strength", "strength", "nutrition"], bio: "Ten years of coaching lifters.", offersNutrition: true });
    assert.deepEqual(profile.specialties, ["strength", "nutrition"]);
    assert.equal(profile.coachingMode, "online");
    assert.equal(profile.acceptingClients, true);
    assert.deepEqual(profile.qualifications, []);
    rejects(() => v.validateTrainerProfile({ title: "S", specialties: ["strength"], bio: "Ten years of coaching." }), /Title/);
    rejects(() => v.validateTrainerProfile({ title: "Coach", specialties: [], bio: "Ten years of coaching." }), /at least one specialty/);
    rejects(() => v.validateTrainerProfile({ title: "Coach", specialties: ["crossfit"], bio: "Ten years of coaching." }), /specialty/);
    rejects(() => v.validateTrainerProfile({ title: "Coach", specialties: ["yoga"], bio: "short" }), /Bio/);
    rejects(() => v.validateTrainerProfile({ title: "Coach", specialties: ["yoga"], bio: "Ten years of coaching.", userId: "user_x" }), /unexpected field: userId/);
    rejects(() => v.validateTrainerProfile({ title: "Coach", specialties: ["yoga"], bio: "Ten years of coaching.", yearsExperience: 61 }), /Years/);
  });

  it("discovery: a search term is escaped for LIKE and the specialty filter is checked", () => {
    assert.deepEqual(v.discoveryQuery({ search: " 50% off_ " }), { search: "50\\% off\\_", specialty: null });
    assert.deepEqual(v.discoveryQuery({ specialty: "yoga" }), { search: null, specialty: "yoga" });
    rejects(() => v.discoveryQuery({ specialty: "pilates" }), /Specialty/);
  });

  it("a recommendation is whole numbers within the target limits", () => {
    assert.deepEqual(v.validateRecommendation({ calories: 2100, proteinG: 160, carbsG: 220, fatG: 60 }), { calories: 2100, proteinG: 160, carbsG: 220, fatG: 60, note: null });
    rejects(() => v.validateRecommendation({ calories: 700, proteinG: 160, carbsG: 220, fatG: 60 }), /Calories/);
    rejects(() => v.validateRecommendation({ calories: 2100, proteinG: 160.5, carbsG: 220, fatG: 60 }), /Protein/);
    rejects(() => v.validateRecommendation({ calories: 2100, proteinG: 160, carbsG: 220, fatG: 60, water: 3 }), /unexpected field: water/);
  });

  it("a diet plan has exactly the five meals, each with foods, in slot order", () => {
    const out = v.validateDietPlan(plan({ meals: [...plan().meals].reverse() }));
    assert.deepEqual(out.meals.map((m) => m.slot), ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"], "sorted into the day's order");
    assert.equal(out.endDate, null);
    rejects(() => v.validateDietPlan(plan({ meals: plan().meals.slice(0, 4) })), /five meals/);
    rejects(() => v.validateDietPlan(plan({ meals: [...plan().meals.slice(0, 4), meal("lunch")] })), /slot can be used once/);
    rejects(() => v.validateDietPlan(plan({ meals: plan().meals.map((m, i) => (i === 0 ? { ...m, items: [] } : m)) })), /at least one food/);
    rejects(() => v.validateDietPlan(plan({ meals: plan().meals.map((m, i) => (i === 0 ? { ...m, time: "8am" } : m)) })), /HH:MM/);
    rejects(() => v.validateDietPlan(plan({ meals: plan().meals.map((m, i) => (i === 0 ? { ...m, items: [food({ quantity: 0 })] } : m)) })), /quantity/);
    rejects(() => v.validateDietPlan(plan({ endDate: "2026-10-01" })), /end date/);
    rejects(() => v.validateDietPlan(plan({ goal: "bulk" })), /Goal/);
    rejects(() => v.validateDietPlan(plan({ clientId: "user_x" })), /unexpected field: clientId/);
  });

  it("logging a plan meal: a date, servings in 0.5 steps per food, an explicit repeat", () => {
    assert.deepEqual(v.validatePlanLog({ date: "2026-10-20" }, 2), { date: "2026-10-20", servings: null, again: false });
    assert.deepEqual(v.validatePlanLog({ date: "2026-10-20", servings: [1.5, 0], again: true }, 2).servings, [1.5, 0]);
    rejects(() => v.validatePlanLog({ date: "2026-10-20", servings: [1] }, 2), /one serving amount per food/);
    rejects(() => v.validatePlanLog({ date: "2026-10-20", servings: [0.3, 1] }, 2), /steps of 0.5/);
    rejects(() => v.validatePlanLog({ date: "2026-10-20", servings: [0, 0] }, 2), /at least one food/);
    rejects(() => v.validatePlanLog({ date: "20-10-2026" }, 2), /YYYY-MM-DD/);
    rejects(() => v.validatePlanLog({ date: "2026-10-20", planMealId: UUID }, 2), /unexpected field/);
  });

  it("a workout plan: days with unique weekdays, exercises from the library with sets", () => {
    const out = v.validateWorkoutPlan(workout({ days: [{ weekday: 3, title: "Lower", exercises: [exercise({ sets: [{ durationSec: 45 }], section: "warmup" })] }, { weekday: 1, title: "Upper", exercises: [exercise()] }] }));
    assert.deepEqual(out.days.map((d) => d.weekday), [1, 3], "sorted by weekday");
    assert.equal(out.days[0].exercises[0].restSec, 90);
    assert.equal(out.days[0].exercises[0].section, "workout");
    rejects(() => v.validateWorkoutPlan(workout({ days: [] })), /at least one training day/);
    rejects(() => v.validateWorkoutPlan(workout({ days: [workout().days[0], workout().days[0]] })), /weekday can be used once/);
    rejects(() => v.validateWorkoutPlan(workout({ days: [{ weekday: 1, title: "Upper", exercises: [] }] })), /at least one exercise/);
    rejects(() => v.validateWorkoutPlan(workout({ days: [{ weekday: 1, title: "Upper", exercises: [exercise({ sets: [] })] }] })), /at least one set/);
    rejects(() => v.validateWorkoutPlan(workout({ days: [{ weekday: 1, title: "Upper", exercises: [exercise({ sets: [{ reps: 8, durationSec: 30 }] })] }] })), /not both/);
    rejects(() => v.validateWorkoutPlan(workout({ days: [{ weekday: 1, title: "Upper", exercises: [exercise({ exerciseId: "bench" })] }] })), /exercise isn't valid/);
    rejects(() => v.validateWorkoutPlan(workout({ days: [{ weekday: 1, title: "Upper", exercises: [exercise({ repsMin: 10, repsMax: 8 })] }] })), /reps to/);
    rejects(() => v.validateWorkoutPlan(workout({ days: [{ weekday: 1, title: "Upper", exercises: [exercise({ restSec: 601 })] }] })), /rest/);
    rejects(() => v.validateWorkoutPlan(workout({ level: "pro" })), /Level/);
    rejects(() => v.validateWorkoutPlan(workout({ userId: "user_x" })), /unexpected field: userId/);
  });
});
