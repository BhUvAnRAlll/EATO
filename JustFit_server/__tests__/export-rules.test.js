// Super Admin › App Usage exports, the pure parts: the report list, CSV quoting and the file name.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../admin/exportRules");
const { ValidationError } = require("../profile");

describe("app usage exports", () => {
  it("only the known reports pass", () => {
    for (const r of rules.REPORTS) assert.equal(rules.reportName(r), r);
    for (const bad of ["users", "../../etc/passwd", "", undefined, "features; DROP"]) assert.throws(() => rules.reportName(bad), ValidationError, String(bad));
  });

  it("cells: commas, quotes and line breaks are quoted; quotes doubled; empty for null", () => {
    assert.equal(rules.cell("plain"), "plain");
    assert.equal(rules.cell("a, b"), "\"a, b\"");
    assert.equal(rules.cell("say \"hi\""), "\"say \"\"hi\"\"\"");
    assert.equal(rules.cell("two\nlines"), "\"two\nlines\"");
    assert.equal(rules.cell(42), "42");
    assert.equal(rules.cell(true), "true");
    assert.equal(rules.cell(null), "");
    assert.equal(rules.cell(undefined), "");
  });

  it("a cell that a spreadsheet would run as a formula is defused", () => {
    assert.equal(rules.cell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
    assert.equal(rules.cell("+1234"), "'+1234");
    assert.equal(rules.cell("-5"), "'-5", "a negative-looking name is defused too; numbers themselves are passed as numbers");
    assert.equal(rules.cell(-5), "-5", "a real number is not");
    assert.equal(rules.cell("@admin"), "'@admin");
  });

  it("the document: a BOM, the header first, CRLF line ends, a trailing line end", () => {
    const csv = rules.toCsv(["name", "uses"], [["Asha, Rao", 3], ["Bala", 0]]);
    assert.equal(csv, "﻿name,uses\r\n\"Asha, Rao\",3\r\nBala,0\r\n");
  });

  it("file names carry the report and the range", () => {
    assert.equal(rules.fileName("features", "2026-10-24", "2026-10-30"), "justfit-features-2026-10-24-to-2026-10-30.csv");
    assert.equal(rules.fileName("overview", "2026-10-30", "2026-10-30"), "justfit-overview-2026-10-30.csv");
    assert.equal(rules.fileName("members", "2026-10-30"), "justfit-members-2026-10-30.csv");
  });
});
