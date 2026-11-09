import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADDED_PLACEHOLDERS, DEFAULT_TEMPLATES, PLACEHOLDERS, SAMPLE_VALUES, TEMPLATE_KINDS, fillTemplate, placeholdersFor, templateNameProblem, templateProblem, templateText, type CustomTemplates } from "../reminderTemplates.ts";

describe("reminder templates", () => {
  it("the defaults are the wording the reminders used before", () => {
    // gymContact's old dueReminder, with and without a due date
    assert.equal(
      fillTemplate(DEFAULT_TEMPLATES.due, { name: "Ravi", gym: "Forma (Tumkur)", amount: "₹1,500", dueBy: "by 15 Nov 2026", code: "FOR-TUM-0003" }),
      "Hi Ravi, this is Forma (Tumkur). A payment of ₹1,500 is due by 15 Nov 2026 for your membership (FOR-TUM-0003). You can pay at the front desk or online. Thank you!",
    );
    assert.equal(
      fillTemplate(DEFAULT_TEMPLATES.due, { name: "Ravi", gym: "Forma (Tumkur)", amount: "₹1,500", dueBy: "", code: "FOR-TUM-0003" }),
      "Hi Ravi, this is Forma (Tumkur). A payment of ₹1,500 is due for your membership (FOR-TUM-0003). You can pay at the front desk or online. Thank you!",
    );
    assert.equal(fillTemplate(DEFAULT_TEMPLATES.expiry, { name: "Ravi", gym: "Forma (Tumkur)", date: "30 Nov 2026" }), "Hi Ravi, your Forma (Tumkur) membership ends on 30 Nov 2026. Renew to keep training with us. See you soon!");
    assert.equal(fillTemplate(DEFAULT_TEMPLATES.expired, { name: "Ravi", gym: "Forma (Tumkur)", date: "1 Nov 2026" }), "Hi Ravi, your Forma (Tumkur) membership ended on 1 Nov 2026. Renew to keep training with us. See you soon!");
    assert.equal(
      fillTemplate(DEFAULT_TEMPLATES.enquiry, { name: "Asha", gym: "Forma (Tumkur)" }),
      "Hi Asha, this is Forma (Tumkur). Thanks for asking about joining us! Would you like to visit for a session this week? Reply here and we'll help you pick a plan.",
    );
  });

  it("every default only uses its own placeholders and passes its own check", () => {
    for (const kind of TEMPLATE_KINDS) {
      assert.equal(templateProblem(kind, DEFAULT_TEMPLATES[kind]), null, kind);
      const used = [...DEFAULT_TEMPLATES[kind].matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
      for (const name of used) assert.ok((PLACEHOLDERS[kind] as string[]).includes(name), `${kind}: {${name}}`);
      assert.doesNotMatch(fillTemplate(DEFAULT_TEMPLATES[kind], SAMPLE_VALUES), /[{}]/, kind);
    }
  });

  it("uses the branch's own wording when it has one", () => {
    const custom: CustomTemplates = { due: "Namaste {name}, please clear {amount}.", expiry: null, expired: null, enquiry: null };
    assert.equal(templateText("due", custom), custom.due);
    assert.equal(templateText("expiry", custom), DEFAULT_TEMPLATES.expiry);
    assert.equal(templateText("due", null), DEFAULT_TEMPLATES.due);
    assert.equal(fillTemplate(templateText("due", custom), { name: "Ravi", amount: "₹500" }), "Namaste Ravi, please clear ₹500.");
  });

  it("fills placeholders, keeps line breaks and leaves unknown braces as typed", () => {
    assert.equal(fillTemplate("Hi {name},\nsee you!", { name: "Ravi" }), "Hi Ravi,\nsee you!");
    assert.equal(fillTemplate("Hi {name} {toString}", { name: "Ravi" }), "Hi Ravi {toString}");
    assert.equal(fillTemplate("Due {dueBy} .", { dueBy: "" }), "Due.");
  });

  it("checks a text as the server does", () => {
    assert.match(templateProblem("due", "short") ?? "", /at least 10/);
    assert.match(templateProblem("due", "a".repeat(301)) ?? "", /300/);
    assert.match(templateProblem("enquiry", "Hi {name}, you owe {amount}") ?? "", /\{amount\}/);
    assert.match(templateProblem("due", "Hi {name, please pay") ?? "", /missing its/);
    assert.equal(templateProblem("due", "Hi {name}, please pay {amount} {dueBy}."), null);
  });

  it("an added template may use every member detail and needs a 2-40 character name", () => {
    assert.deepEqual(placeholdersFor("added"), ADDED_PLACEHOLDERS);
    assert.deepEqual(placeholdersFor("enquiry"), PLACEHOLDERS.enquiry);
    assert.equal(templateProblem("added", "Hi {name}, {amount} due {dueBy}, ends {date} at {gym} ({code})."), null);
    assert.match(templateProblem("added", "Hi {nmae}, see you soon.") ?? "", /\{nmae\}/);
    assert.match(templateProblem("enquiry", "Hi {name}, you owe {amount}.") ?? "", /\{amount\}/);
    assert.equal(templateNameProblem("  Festive   offer "), null);
    assert.match(templateNameProblem(" a ") ?? "", /Give the template a name/);
    assert.match(templateNameProblem("a".repeat(41)) ?? "", /40 characters/);
  });
});
