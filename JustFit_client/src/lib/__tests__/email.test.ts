// The optional contact email on setup step 1 (lib/email.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMAIL_MAX, isValidEmail } from "../email.ts";

describe("contact email", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of ["ravi@example.com", "ravi.kumar+gym@mail.co.in", "A@B.IN"]) assert.equal(isValidEmail(ok), true, ok);
  });

  it("refuses what isn't an address", () => {
    for (const bad of ["", "ravi", "ravi@", "@example.com", "ravi@example", "ravi kumar@example.com", "ravi@@example.com", "ravi@example.c"]) {
      assert.equal(isValidEmail(bad), false, bad);
    }
  });

  it("refuses an address longer than the database keeps", () => {
    assert.equal(isValidEmail(`${"a".repeat(60)}@${"b".repeat(EMAIL_MAX)}.com`), false);
  });
});
