const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const { workbook, columnName, xml } = require("../gym/xlsx");
const att = require("../gym/attendanceRules");

// The zip's entries by name, inflated (a reader of our own, enough for the files we write)
function unzip(buffer) {
  const files = {};
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const name = buffer.toString("utf8", at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength;
    const data = zlib.inflateRawSync(buffer.subarray(start, start + size));
    assert.equal(zlib.crc32(data), buffer.readUInt32LE(at + 14), `${name}: checksum`);
    files[name] = data.toString("utf8");
    at = start + size;
  }
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50, "the zip ends with its directory");
  return files;
}

const visit = (over = {}) => ({
  date: "2026-11-09", memberCode: "FOR-TUM-0001", memberName: "Ravi Kumar", checkInTime: "2026-11-09 06:10",
  checkOutTime: "2026-11-09 07:05", durationMin: 55, status: "completed", inSource: "qr", checkInDistanceM: 12, ...over,
});

describe("gym Excel export", () => {
  it("names columns as Excel does", () => {
    assert.deepEqual([0, 8, 25, 26, 27, 701, 702].map(columnName), ["A", "I", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("escapes XML and drops control characters", () => {
    assert.equal(xml(`<a href="x">&\u0007</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("writes a workbook: the parts, a bold frozen header, a filter, numbers as numbers", () => {
    const files = unzip(workbook(att.toSheet([visit(), visit({ memberName: "Asha", checkOutTime: null, durationMin: null, status: "inside", inSource: "staff", checkInDistanceM: null })])));
    assert.deepEqual(Object.keys(files).sort(), ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = files["xl/worksheets/sheet1.xml"];
    assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Date<\/t>/);
    assert.match(sheet, /state="frozen"/);
    assert.match(sheet, /<autoFilter ref="A1:I3"\/>/);
    assert.match(sheet, /<c r="F2"><v>55<\/v><\/c>/, "the duration is a number");
    assert.match(sheet, /<c r="G3" t="inlineStr"><is><t xml:space="preserve">Inside<\/t>/);
    assert.ok(!/<c r="E3"/.test(sheet), "an empty check-out is an empty cell");
    assert.match(files["xl/workbook.xml"], /<sheet name="Attendance"/);
  });

  it("never writes a formula: a cell that starts with = stays text", () => {
    const sheet = unzip(workbook(att.toSheet([visit({ memberName: '=HYPERLINK("http://x")' })])))["xl/worksheets/sheet1.xml"];
    assert.ok(!sheet.includes("<f>"));
    assert.match(sheet, /<c r="C2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;http:\/\/x&quot;\)<\/t>/);
  });

  it("an empty report is the header alone", () => {
    const sheet = unzip(workbook(att.toSheet([])))["xl/worksheets/sheet1.xml"];
    assert.match(sheet, /<autoFilter ref="A1:I1"\/>/);
    assert.equal((sheet.match(/<row /g) ?? []).length, 1);
  });

  it("?format= takes csv (the default) or xlsx and nothing else; the rest is the history's query", () => {
    assert.equal(att.exportQuery({}, "2026-11-09").format, "csv");
    const q = att.exportQuery({ format: "xlsx", from: "2026-11-01", to: "2026-11-09" }, "2026-11-09");
    assert.equal(q.format, "xlsx");
    assert.equal(q.query.from, "2026-11-01");
    for (const format of ["pdf", "XLSX", "xlsx'; DROP TABLE gym_attendance;--", ["xlsx"]]) {
      assert.throws(() => att.exportQuery({ format }, "2026-11-09"), /csv or xlsx/);
    }
    assert.throws(() => att.exportQuery({ format: "xlsx", extra: "1" }, "2026-11-09"), /fields we don't use/);
  });
});
