import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categoriesFor, safeLink, whenText } from "../notificationRules.ts";

describe("Notification words and links", () => {
  it("opens only screens on the list", () => {
    assert.equal(safeLink("/gym-hub/12"), "/gym-hub/12");
    assert.equal(safeLink("/admin/gyms/3"), "/admin/gyms/3");
    for (const bad of ["https://evil.example", "/admin/users", "//evil", "/gym-hub/1/../x", null, undefined]) assert.equal(safeLink(bad), null, String(bad));
  });

  it("says when, briefly", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    assert.equal(whenText("2026-11-10T11:59:40Z", now), "just now");
    assert.equal(whenText("2026-11-10T11:45:00Z", now), "15 min ago");
    assert.equal(whenText("2026-11-10T09:00:00Z", now), "3 h ago");
    assert.equal(whenText("2026-11-09T09:00:00Z", now), "yesterday");
  });

  it("shows each account the categories it hears about", () => {
    assert.deepEqual(categoriesFor("admin"), ["registration", "platform"]);
    assert.ok(categoriesFor("gym_admin").includes("attendance"));
    assert.ok(categoriesFor("user").includes("membership"));
  });
});
