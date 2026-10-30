// Pure rules for Super Admin › App Usage exports (no database), unit-tested directly: which
// reports exist, how rows become CSV (RFC 4180 quoting, a UTF-8 BOM so Excel reads the
// characters right), and the file name for a report and range.
const { ValidationError } = require("../profile");

const REPORTS = ["overview", "features", "members", "retention", "daily"];

// One report name from the query, nothing else
function reportName(value) {
  if (!REPORTS.includes(value)) throw new ValidationError("Pick a report: overview, features, members, retention or daily.");
  return value;
}

// A CSV cell: text with a comma, quote, or line break is quoted, quotes doubled; null is empty.
// A cell starting with = + - @ gets a leading apostrophe, so a spreadsheet never runs it as a
// formula (a member could name themselves "=HYPERLINK(...)").
function cell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value); // a real number is data, never a formula
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

// Rows (arrays of cells) into one CSV document, with the header row first
function toCsv(header, rows) {
  const lines = [header, ...rows].map((r) => r.map(cell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// "justfit-features-2026-10-24-to-2026-10-30.csv"
const fileName = (report, from, to) => `justfit-${report}-${from}${to && to !== from ? `-to-${to}` : ""}.csv`;

module.exports = { REPORTS, reportName, cell, toCsv, fileName };
