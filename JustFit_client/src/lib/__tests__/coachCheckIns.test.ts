import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHECK_IN_HOUR, CHECK_IN_MINUTE, CHECK_IN_ROUTE, checkInContent } from "../coachCheckInRules.ts";

describe("coach check-in notification", () => {
  it("names the coach when known", () => {
    assert.equal(checkInContent("Priya").title, "Priya checked in on your day");
    assert.equal(checkInContent(null).title, "Your coach checked in on your day");
    assert.equal(checkInContent("  ").title, "Your coach checked in on your day");
    assert.match(checkInContent("Priya").body, /How did today go/);
  });

  it("fires at 8:30 pm and opens the chat's check-in", () => {
    assert.deepEqual([CHECK_IN_HOUR, CHECK_IN_MINUTE], [20, 30]);
    assert.equal(CHECK_IN_ROUTE, "/coach/chat?followup=1");
  });
});
