// The Super Admin's member page words (lib/memberProfileText.ts) and a kept scan's rows (lib/bodyScanText.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memberSections, type MemberProfile } from "../memberProfileText.ts";
import { scanReportRows, scanWhen } from "../bodyScanText.ts";

const base: MemberProfile = {
  id: "u1",
  contact: { phone: "9876543210", email: null },
  joinedAt: "2026-11-01T06:30:00.000Z",
  lastActiveAt: null,
  profile: {
    complete: true, dob: "1996-04-02", age: 30, gender: "female", heightCm: 170, weightKg: 70, bodyFatPercent: null,
    goal: "fat_loss", activity: "lightly_active", healthFlags: ["medical_condition"], diet: "vegetarian", cuisines: ["South Indian"],
    dislikes: "", allergies: "peanuts", mealsPerDay: "3", workoutFrequency: null, workoutType: null, workoutTime: null, updatedAt: null,
  },
  targets: null,
  coach: null,
  scans: [],
  activity: [],
};
const value = (m: MemberProfile, title: string, label: string) => memberSections(m).find((s) => s.title === title)?.rows.find((r) => r.label === label)?.value;

describe("the admin's member page", () => {
  it("shows every answer in the member's words, and Not set for what is missing", () => {
    assert.equal(value(base, "Contact", "Mobile"), "+91 98765 43210");
    assert.equal(value(base, "Contact", "Email"), "Not set");
    assert.equal(value(base, "Personal details", "Date of birth"), "2 Apr 1996 · 30 y");
    assert.equal(value(base, "Personal details", "Gender"), "Female");
    assert.equal(value(base, "Personal details", "Body fat"), "Not set");
    assert.equal(value(base, "Goal and health", "Goal"), "Lose fat");
    assert.equal(value(base, "Goal and health", "Health"), "Medical condition affecting diet");
    assert.equal(value(base, "Food", "Diet"), "Vegetarian");
    assert.equal(value(base, "Food", "Food you usually eat"), "South Indian");
    assert.equal(value(base, "Food", "Dislikes"), "Not set");
    assert.equal(value(base, "Daily targets", "Targets"), "Not set");
    assert.equal(value(base, "AI Coach intake", "Intake"), "Not done");
  });

  it("a member who hasn't started setup has one row saying so", () => {
    const sections = memberSections({ ...base, profile: null });
    assert.deepEqual(sections.find((s) => s.title === "Profile")?.rows, [{ label: "Setup", value: "Not started" }]);
  });

  it("the coach intake reads in its own labels", () => {
    const m: MemberProfile = { ...base, coach: {
      goal: "build_muscle", experience: "beginner", currentlyTraining: true, weekdays: [1, 3], sessionMinutes: 45, mainSpot: "gym", backupSpot: null,
      mainEquipment: "full_gym", backupEquipment: null, joints: ["knees"], conditions: [], limitationNotes: null, cookingTime: "quick", foodBudget: "medium",
      stress: null, sleep: "7_8", coach: "priya", coachStyle: "supportive", planNotes: null, updatedAt: null } };
    assert.equal(value(m, "AI Coach intake", "Goal"), "Build muscle");
    assert.equal(value(m, "AI Coach intake", "Main spot"), "Gym · Full gym");
    assert.equal(value(m, "AI Coach intake", "Health conditions"), "None");
    assert.match(value(m, "AI Coach intake", "Coach") ?? "", /^Coach Priya|^Priya/);
  });
});

describe("a kept scan's words", () => {
  it("leaves out numbers the scan didn't produce", () => {
    const rows = scanReportRows({ score: 71, fatMassKg: 19.25, bmi: 24.22, waistCm: null } as never);
    assert.deepEqual(rows.map((r) => r.label), ["Body score", "Fat mass", "BMI"]);
    assert.equal(rows[1].value, "19.3 kg");
  });
  it("dates the scan in India's time", () => {
    assert.match(scanWhen("2026-11-10T10:35:00.000Z"), /10 Nov 2026.*4:05/);
    assert.equal(scanWhen("nonsense"), "");
  });
});
