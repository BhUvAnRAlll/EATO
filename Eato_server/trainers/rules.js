// The pure rules of trainer ↔ client coaching (no database, no Clerk), unit-tested in
// __tests__/trainer-rules.test.js. trainers.js applies them to rows it loaded for the
// verified caller.

// Which parts of a trainer's profile a member may see: the basics always; the coaching
// approach, qualifications and languages only once the trainer accepted them (or to the
// trainer themselves). The locked fields come back as null, with `locked: true`.
const LOCKED_FIELDS = ["approach", "qualifications", "languages"];

function profileForViewer(profile, { connected = false, own = false } = {}) {
  const unlocked = connected || own;
  const out = { ...profile, locked: !unlocked };
  if (!unlocked) for (const field of LOCKED_FIELDS) out[field] = null;
  return out;
}

// "none" (no request), "requested" (waiting for the trainer), "connected", from the client's side
function connectionState(row) {
  if (!row) return "none";
  if (row.status === "connected") return "connected";
  if (row.status === "requested") return "requested";
  return "none";
}

// Why the member can't message this trainer (null = they can)
function messageLockReason(state, trainerName) {
  const first = (trainerName || "").trim().split(/\s+/)[0] || "them";
  if (state === "connected") return null;
  if (state === "requested") return `Messaging unlocks when ${first} accepts your request.`;
  return `Send ${first} a connection request to message them.`;
}

// A recommendation is "new" until the member applies it; a newer one than the last applied is new again
function recommendationIsNew(recommendation) {
  return Boolean(recommendation) && recommendation.applied_at === null;
}

// The diary slot a plan meal logs into (the diary has one snack slot)
const DIARY_SLOT = { breakfast: "breakfast", morning_snack: "snack", lunch: "lunch", evening_snack: "snack", dinner: "dinner" };
const diarySlotFor = (planSlot) => DIARY_SLOT[planSlot];

// The key that makes logging a plan meal idempotent: one per date and meal, "#n" for a deliberate repeat
const planLogKey = (date, mealId, n = 1) => `${date}:${mealId}:${n}`;

// Totals of a list of foods, as the diary sums them
function totalsOf(items) {
  const sum = (key) => Math.round(items.reduce((total, item) => total + Number(item[key] || 0), 0) * 10) / 10;
  return { kcal: sum("kcal"), proteinG: sum("proteinG"), carbsG: sum("carbsG"), fatG: sum("fatG") };
}

// Foods scaled by the servings the member chose (0 = skipped), in the plan's order
function scaleItems(items, servings) {
  return items.flatMap((item, index) => {
    const factor = servings[index] ?? 1;
    if (factor <= 0) return [];
    const scale = (value) => Math.round(Number(value) * factor * 10) / 10;
    return [{ name: item.name, quantity: Math.round(Number(item.quantity) * factor * 100) / 100, unit: item.unit, kcal: scale(item.kcal), proteinG: scale(item.proteinG), carbsG: scale(item.carbsG), fatG: scale(item.fatG) }];
  });
}

module.exports = { LOCKED_FIELDS, profileForViewer, connectionState, messageLockReason, recommendationIsNew, diarySlotFor, planLogKey, totalsOf, scaleItems };
