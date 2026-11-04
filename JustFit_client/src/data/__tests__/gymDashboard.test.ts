// The gym portal's small input helpers (data/gymDashboard.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dobFromText, dobInput, phoneInput } from "../gymDashboard.ts";

describe("gym portal inputs", () => {
  it("mobile numbers keep to 10 digits, whatever is typed or pasted", () => {
    assert.equal(phoneInput("9876543210"), "9876543210");
    assert.equal(phoneInput("98765 43210"), "9876543210");
    assert.equal(phoneInput("+91 98765-43210"), "9876543210", "a pasted +91");
    assert.equal(phoneInput("919876543210"), "9876543210");
    assert.equal(phoneInput("09876543210"), "9876543210", "a leading 0");
    assert.equal(phoneInput("84546345584"), "8454634558", "an 11th digit is never kept");
    assert.equal(phoneInput("98a76"), "9876");
  });

  it("dates of birth are typed as DD-MM-YYYY", () => {
    assert.equal(dobInput("30072004"), "30-07-2004");
    assert.equal(dobFromText("30-07-2004"), "2004-07-30");
    assert.equal(dobFromText("30-07-04"), null);
  });
});
