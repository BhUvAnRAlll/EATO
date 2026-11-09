// Gym Hub's membership page (2026-11-09): one of the member's own memberships with its payments,
// its pauses (and how many), and its attendance a month at a time. The membership is matched by
// the account's verified phone (gym_members.phone), as everywhere in the member app; every query
// below is scoped to that one gym_members row and its gym, so nothing of another member's or
// another gym's is read. Read only: nothing is written.
const pauses = require("./pauses");
const rules = require("./memberHubRules");

const ms = (column) => `CAST(UNIX_TIMESTAMP(${column}) * 1000 AS UNSIGNED)`;
const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
const PAYMENT_LIMIT = 50;

const PAYMENT_LABEL = { admission: "Admission", renewal: "Renewal", due: "Due payment", pt: "Personal training", service: "Service", sale: "Product" };

async function detail(pool, userId, memberId, query, today) {
  const { row, membership } = await pauses.oneMembership(pool, userId, memberId, today);
  const { month } = rules.hubQuery(query, today);
  const bounds = rules.monthBounds(month, today);

  const [[payments], [pauseRows], [visitRows], [[stats]]] = await Promise.all([
    pool.query(
      `SELECT id, kind, detail, method, amount, ${DAY("paid_on")} AS paid_on FROM gym_payments
       WHERE member_id = ? AND gym_id = ? ORDER BY paid_on DESC, id DESC LIMIT ?`,
      [row.id, row.gym_id, PAYMENT_LIMIT],
    ),
    pool.query(
      `SELECT ${pauses.PAUSE_COLUMNS} FROM gym_membership_pauses p WHERE p.member_id = ? ORDER BY p.id DESC LIMIT 50`,
      [row.id],
    ),
    pool.query(
      `SELECT a.id, ${DAY("a.on_date")} AS on_date, ${ms("a.checked_in_at")} AS in_ms, ${ms("a.checked_out_at")} AS out_ms, a.duration_min, a.status,
         a.on_date < ? AS stale
       FROM gym_attendance a WHERE a.member_id = ? AND a.gym_id = ? AND a.on_date BETWEEN ? AND ?
       ORDER BY a.checked_in_at DESC, a.id DESC`,
      [today, row.id, row.gym_id, bounds.from, bounds.to],
    ),
    // Visit days, not check-ins: two visits on one day count once
    pool.query(
      `SELECT COUNT(DISTINCT a.on_date) AS total_days,
         COUNT(DISTINCT CASE WHEN a.on_date >= ? THEN a.on_date END) AS this_month,
         COUNT(DISTINCT CASE WHEN a.on_date >= ? THEN a.on_date END) AS last_7_days,
         ROUND(AVG(CASE WHEN a.status = 'completed' AND a.on_date >= ? THEN a.duration_min END)) AS average_min,
         ${DAY("MAX(a.on_date)")} AS last_visit
       FROM gym_attendance a WHERE a.member_id = ? AND a.gym_id = ?`,
      [`${today.slice(0, 7)}-01`, addDays(today, -6), addDays(today, -29), row.id, row.gym_id],
    ),
  ]);

  const visits = visitRows.map((r) => ({
    id: r.id,
    date: r.on_date,
    // A visit left open on an earlier day reads as no check-out, as in the portal
    status: r.status === "inside" && Number(r.stale) === 1 ? "no_checkout" : r.status,
    checkedInAt: new Date(Number(r.in_ms)).toISOString(),
    checkedOutAt: r.out_ms ? new Date(Number(r.out_ms)).toISOString() : null,
    durationMin: r.duration_min,
  }));
  const allPauses = pauseRows.map(pauses.pauseOf);

  return {
    today,
    membership: { ...membership, history: allPauses },
    pauseCounts: {
      approved: allPauses.filter((p) => p.status === "approved").length,
      requested: allPauses.filter((p) => p.by === "member").length,
      daysPaused: allPauses.filter((p) => p.status === "approved").reduce((sum, p) => sum + (p.extendedDays ?? p.days), 0),
    },
    payments: payments.map((p) => ({ id: p.id, kind: p.kind, label: PAYMENT_LABEL[p.kind] ?? p.kind, detail: p.detail, method: p.method, amount: p.amount, paidOn: p.paid_on })),
    attendance: {
      month,
      previousMonth: bounds.previous,
      nextMonth: bounds.next,
      days: rules.calendarDays(visits),
      visits,
      stats: {
        thisMonth: Number(stats.this_month),
        last7Days: Number(stats.last_7_days),
        totalDays: Number(stats.total_days),
        averageMin: stats.average_min === null ? null : Number(stats.average_min),
        lastVisit: stats.last_visit,
      },
    },
  };
}

function addDays(day, n) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

module.exports = { detail };
