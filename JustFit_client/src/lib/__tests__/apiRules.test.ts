// apiFetch's decisions (lib/apiRules.ts): how long a request may take, and how an answer that
// isn't JSON (a proxy's 502 page, an empty body) is read.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { errorLine, readJson, REQUEST_TIMEOUT_MS, serverProblem, SLOW_REQUEST_TIMEOUT_MS, timeoutFor } from "../apiRules.ts";

describe("timeoutFor", () => {
  it("gives AI and photo routes the long wait and everything else the short one", () => {
    for (const path of ["/api/coach/plan", "/api/coach/chat", "/api/workout/plan", "/api/fitness/programs", "/api/body-composition/scan", "/api/macro/scan", "/api/macro/estimate", "/api/admin/portal/exercises/draft", "/api/admin/portal/programs"]) {
      assert.equal(timeoutFor(path), SLOW_REQUEST_TIMEOUT_MS, path);
    }
    for (const path of ["/api/profile", "/api/macro/day?date=2026-11-02", "/api/macro/water", "/api/auth/me", "/api/admin/portal/users", "/api/home-content", "/api/coachx"]) {
      assert.equal(timeoutFor(path), REQUEST_TIMEOUT_MS, path);
    }
  });

  it("waits longer than the server's own AI timeout", () => {
    assert.ok(SLOW_REQUEST_TIMEOUT_MS > 90_000, "the server gives OpenAI 45 s and one retry, Forma 90 s");
  });
});

describe("readJson and errorLine", () => {
  it("reads JSON, including a bare null (the profile before setup)", () => {
    assert.deepEqual(readJson('{"a":1}'), { json: true, value: { a: 1 } });
    assert.deepEqual(readJson("null"), { json: true, value: null });
  });

  it("an HTML error page or an empty body is not JSON", () => {
    assert.deepEqual(readJson("<html><body>502 Bad Gateway</body></html>"), { json: false });
    assert.deepEqual(readJson(""), { json: false });
  });

  it("takes the server's error line only when it is a string", () => {
    assert.equal(errorLine(readJson('{"error":"Please sign in again."}')), "Please sign in again.");
    assert.equal(errorLine(readJson('{"error":42}')), null);
    assert.equal(errorLine(readJson("null")), null);
    assert.equal(errorLine(readJson("<html>")), null);
  });

  it("names the status of a server problem", () => {
    assert.match(serverProblem(502), /\(502\)/);
  });
});
