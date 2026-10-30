// Super Admin › App Usage › Export: the same numbers the screens show, as CSV files, with the
// screen's filters applied (the range for overview, features and daily; the sort and search for
// members; the unit for retention). Admins only (requireAdmin on every request), read-only,
// built from admin/usage.js and admin/retention.js so a file never disagrees with a screen.
// Excel output is not offered: it would need a library (see the note at the end).
const usage = require("./usage");
const retention = require("./retention");
const rules = require("./exportRules");

const pct = (v) => (v === null || v === undefined ? "" : v);

async function exportCsv(pool, query) {
  const report = rules.reportName(query.report);
  if (report === "overview") {
    const s = await usage.summary(pool, query);
    const rows = [
      ["Range", `${s.range.from} to ${s.range.to}`],
      ["Compared with", `${s.range.previousFrom} to ${s.range.previousTo}`],
      ["Registered members", s.members.registered],
      ["New members in range", s.members.newInPeriod],
      ["Active members", s.members.active],
      ["Active members, period before", s.members.previousActive],
      ["Active members, change %", pct(s.members.activeChangePercent)],
      ["Active members, % of registered", s.members.activePercent],
      ["Feature uses", s.totals.uses],
      ["Feature uses per active member", s.totals.usesPerActiveMember],
    ];
    if (s.engagement) {
      rows.push(["App sessions", s.engagement.sessions.total], ["App sessions, period before", s.engagement.sessions.previousTotal], ["Sessions per member", s.engagement.sessions.perMember], ["Average session, seconds", s.engagement.sessions.avgSeconds]);
      for (const sc of s.engagement.screens) rows.push([`Screen visits: ${sc.screen}`, sc.visits], [`Screen visitors: ${sc.screen}`, sc.members]);
    }
    for (const n of s.notTracked) rows.push([`Not tracked: ${n.label}`, n.reason]);
    return { fileName: rules.fileName("overview", s.range.from, s.range.to), csv: rules.toCsv(["Metric", "Value"], rows) };
  }
  if (report === "features") {
    const s = await usage.summary(pool, query);
    const header = ["Rank", "Feature", "Area", "Members", "Uses", "Uses per member", "% of active members", "Members, period before", "Uses, period before", "Change in members %", "Declining", "Unused"];
    const rows = s.features.map((f, i) => [i + 1, f.label, s.modules.find((m) => m.id === f.module)?.label ?? f.module, f.members, f.uses, f.usesPerMember, f.sharePercent, f.previousMembers, f.previousUses, pct(f.changePercent), f.declining ? "yes" : "no", f.unused ? "yes" : "no"]);
    return { fileName: rules.fileName("features", s.range.from, s.range.to), csv: rules.toCsv(header, rows) };
  }
  if (report === "daily") {
    const s = await usage.summary(pool, query);
    return { fileName: rules.fileName("daily", s.range.from, s.range.to), csv: rules.toCsv(["Date", "Active members"], s.series.map((p) => [p.key, p.members])) };
  }
  if (report === "members") {
    // Every page, in the screen's order, up to a sane cap
    const all = [];
    let page = 1;
    let list;
    do {
      list = await retention.members(pool, { ...query, page: String(page) });
      all.push(...list.members);
      page += 1;
    } while (list.members.length === list.pageSize && all.length < 10_000);
    const header = ["Member id", "Name", "Joined", "Last active", "Sessions", "Interactions", "Active days", "Most used feature", "Most used, count"];
    const rows = all.map((m) => [m.id, m.name, m.joined, m.lastActive, m.sessions ?? "", m.interactions, m.activeDays, m.mostUsed?.label ?? "", m.mostUsed?.uses ?? ""]);
    const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
    return { fileName: rules.fileName("members", today), csv: rules.toCsv(header, rows) };
  }
  // retention
  const r = await retention.retention(pool, query);
  const most = Math.max(0, ...r.cohorts.map((c) => c.periods.length));
  const header = ["Cohort", "Joined", "Day 1 %", "Day 7 %", "Day 30 %", ...Array.from({ length: most }, (_, i) => `${r.unit === "week" ? "Week" : "Month"} ${i} %`)];
  const rows = r.cohorts.map((c) => [c.cohort, c.joined, pct(c.retention.day1), pct(c.retention.day7), pct(c.retention.day30), ...c.periods, ...Array(most - c.periods.length).fill("")]);
  const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
  return { fileName: rules.fileName(`retention-by-${r.unit}`, today), csv: rules.toCsv(header, rows) };
}

// Note on Excel: a real .xlsx needs a library (for example exceljs). CSV opens in Excel, Numbers
// and Sheets as it is, keeps every character (the BOM), and never runs a cell as a formula.

module.exports = { exportCsv };
