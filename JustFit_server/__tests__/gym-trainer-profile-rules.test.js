// Trainer profiles (Gym Profile phase 3, 2026-11-09): what the gym writes about a trainer login
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/trainerProfileRules");

const closed = () => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

describe("Trainer profile rules", () => {
  it("takes specialisations, certifications, years, a bio, availability and on/off", () => {
    const week = { ...closed(), mon: [["06:00", "10:00"], ["17:00", "21:00"]] };
    const body = rules.trainerProfileBody({ specializations: [" Strength ", "Weight  loss"], certifications: ["ACE CPT"], years: 6, bio: "  Certified since 2018. ", availability: week, active: true });
    assert.deepEqual(body, { specializations: ["Strength", "Weight loss"], certifications: ["ACE CPT"], years: 6, bio: "Certified since 2018.", availability: week, active: true });
    assert.deepEqual(rules.trainerProfileBody({ years: null, bio: "", availability: null }), { years: null, bio: null, availability: null });
  });

  it("refuses what doesn't fit, and anything unexpected", () => {
    for (const [payload, message] of [
      [{}, /Change something/],
      [{ userId: "user_x" }, /Unexpected field/],
      [{ specializations: ["Yoga", "yoga"] }, /twice/],
      [{ specializations: ["Y"] }, /2 to 40/],
      [{ specializations: Array.from({ length: 9 }, (_, i) => `Skill ${i}`) }, /up to 8/],
      [{ certifications: ["x".repeat(81)] }, /2 to 80/],
      [{ years: 61 }, /0 to 60/],
      [{ years: 2.5 }, /whole number/],
      [{ years: "5" }, /whole number/],
      [{ bio: "x".repeat(501) }, /500 characters/],
      [{ availability: { mon: [] } }, /every day/],
      [{ active: "yes" }, /members see/],
      [[], /as an object/],
    ]) assert.throws(() => rules.trainerProfileBody(payload), message, JSON.stringify(payload));
  });

  it("reads stored rows back safely and names only trainers with a name", () => {
    const profile = rules.profileOf({ specializations: '["Strength"]', certifications: "not json", years_experience: 4, bio: null, availability: null, active: 1 });
    assert.deepEqual(profile, { specializations: ["Strength"], years: 4, certifications: [], bio: null, availability: null, active: true });
    assert.deepEqual(rules.profileOf(undefined), { specializations: [], years: null, certifications: [], bio: null, availability: null, active: false });
    assert.equal(rules.displayName("  Ravi Kumar "), "Ravi Kumar");
    assert.equal(rules.displayName(""), null);
    assert.equal(rules.displayName(null), null);
  });
});
