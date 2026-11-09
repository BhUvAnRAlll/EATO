import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUSINESS_TYPES, REVIEW_ACTIONS, fileSize, missingIn, orNull, reasonProblem, statusMessage } from "../gymRegistrationRules.ts";

describe("Register your gym words", () => {
  it("tells the applicant where the application stands", () => {
    assert.equal(statusMessage({ status: "draft", statusNote: null, gymName: "Iron House" }).title, "Finish your application");
    const asked = statusMessage({ status: "draft", statusNote: "Add the shop licence.", gymName: "Iron House" });
    assert.equal(asked.tone, "warn");
    assert.equal(asked.body, "Add the shop licence.");
    assert.equal(statusMessage({ status: "approved", statusNote: null, gymName: "Iron House" }).title, "Iron House is approved");
    assert.equal(statusMessage({ status: "rejected", statusNote: "Address not verified.", gymName: "X" }).body, "Address not verified.");
    assert.equal(statusMessage({ status: "suspended", statusNote: null, gymName: "X" }).tone, "bad");
  });

  it("counts what is missing per section", () => {
    const app = { missing: [{ key: "business" as const, text: "A contact person" }, { key: "business" as const, text: "The type" }, { key: "documents" as const, text: "An address proof" }] };
    assert.equal(missingIn(app, "business"), 2);
    assert.equal(missingIn(app, "location"), 0);
  });

  it("formats sizes and clears empty fields", () => {
    assert.equal(fileSize(200), "1 KB");
    assert.equal(fileSize(240 * 1024), "240 KB");
    assert.equal(fileSize(1.25 * 1024 * 1024), "1.3 MB");
    assert.equal(orNull("   "), null);
    assert.equal(orNull(" LLP "), "LLP");
    assert.equal(BUSINESS_TYPES.length, 5);
  });

  it("asks for a reason where the review needs one", () => {
    assert.match(reasonProblem("reject", "no") ?? "", /reason/);
    assert.equal(reasonProblem("reject", "Address proof unreadable."), null);
    assert.equal(reasonProblem("approve", ""), null);
    assert.match(reasonProblem("approve", "x".repeat(301)) ?? "", /300/);
    assert.equal(REVIEW_ACTIONS.suspend.danger, true);
  });
});
