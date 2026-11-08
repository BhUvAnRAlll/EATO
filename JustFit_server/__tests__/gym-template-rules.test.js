// Reminder Templates' rules (gym/templateRules.js): which messages a branch may reword, and what a
// saved text may hold.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/templateRules");

describe("reminder template rules", () => {
  it("knows the four messages and nothing else", () => {
    assert.deepEqual(rules.KINDS, ["due", "expiry", "expired", "enquiry"]);
    for (const kind of rules.KINDS) assert.equal(rules.kindParam(kind), kind);
    for (const bad of ["invoice", "birthday", "DUE", "due ", "", "constructor", "__proto__", "1 OR 1=1", undefined]) {
      assert.throws(() => rules.kindParam(bad), /isn't one of the reminder templates/, String(bad));
    }
  });

  it("accepts a text with the kind's own placeholders, trimmed and tidied", () => {
    assert.deepEqual(rules.templateBody("due", { text: "  Hi {name}, {amount} is due {dueBy} at {gym} ({code}).  " }), { text: "Hi {name}, {amount} is due {dueBy} at {gym} ({code})." });
    assert.deepEqual(rules.templateBody("expiry", { text: "Hi {name},\r\nyour plan ends on {date}.\n\n\n\nSee you!" }), { text: "Hi {name},\nyour plan ends on {date}.\n\nSee you!" });
    assert.deepEqual(rules.templateBody("enquiry", { text: "Hello there, come visit us this week!" }), { text: "Hello there, come visit us this week!" });
    // Emoji and other languages are fine
    assert.equal(rules.templateBody("expired", { text: "नमस्ते {name} 💪, renew at {gym}!" }).text, "नमस्ते {name} 💪, renew at {gym}!");
  });

  it("refuses a placeholder the kind can't fill, or a stray brace", () => {
    assert.throws(() => rules.templateBody("enquiry", { text: "Hi {name}, you owe {amount}." }), /\{amount\} isn't a placeholder/);
    assert.throws(() => rules.templateBody("expiry", { text: "Hi {nmae}, your plan ends soon." }), /\{nmae\}/);
    assert.throws(() => rules.templateBody("due", { text: "Hi {name, please pay soon." }), /missing its \{ or \}/);
    assert.throws(() => rules.templateBody("due", { text: "Hi name}, please pay soon." }), /missing its \{ or \}/);
    assert.throws(() => rules.templateBody("due", { text: "Hi {}, please pay soon today." }), /\{\} isn't a placeholder/);
    assert.throws(() => rules.templateBody("due", { text: "Hi {constructor}, please pay." }), /isn't a placeholder/);
  });

  it("refuses the wrong shape, length or characters", () => {
    for (const body of [null, [], "text", { text: 5 }, { text: "Hello there friend", extra: 1 }, {}]) {
      assert.throws(() => rules.templateBody("due", body), /Send the template's text/, JSON.stringify(body));
    }
    assert.throws(() => rules.templateBody("due", { text: "   short  " }), /at least 10/);
    assert.throws(() => rules.templateBody("due", { text: "a".repeat(301) }), /300 characters/);
    assert.equal(rules.templateBody("due", { text: "a".repeat(300) }).text.length, 300);
    assert.throws(() => rules.templateBody("due", { text: "Hello\u0000 there friend" }), /characters we can't send/);
    assert.throws(() => rules.templateBody("due", { text: "Hello\tthere friend" }), /characters we can't send/);
  });

  it("stores SQL and markup as plain text (the query is parameterised; the app shows text only)", () => {
    const text = "Hi {name}'; DROP TABLE gym_members; -- <script>x</script>";
    assert.equal(rules.templateBody("due", { text }).text, text);
  });
});
