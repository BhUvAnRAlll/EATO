// Pure rules for the gym owner portal (no database), unit-tested in __tests__/owner-rules.test.js.

// Where a member's package stands, from the days left on it (null = no package recorded)
function renewalFlag(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return "none";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 7) return "this_week";
  if (daysLeft <= 30) return "this_month";
  return "active";
}

// Renewals list order: expired first (longest ago first), then soonest to end, then no package
function byDaysLeft(a, b) {
  if (a.daysLeft === null && b.daysLeft === null) return a.member.name.localeCompare(b.member.name);
  if (a.daysLeft === null) return 1;
  if (b.daysLeft === null) return -1;
  return a.daysLeft - b.daysLeft || a.member.name.localeCompare(b.member.name);
}

// The last `count` months as "YYYY-MM" keys, oldest first, ending with the month of `now`
function lastMonths(now, count = 6) {
  const months = [];
  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

// A new end date for a renewal: `months` added to the later of the current end and today
// (an expired package restarts from today, an active one is extended). Dates are "YYYY-MM-DD".
function renewedEnd(currentEnd, today, months) {
  const base = currentEnd && currentEnd > today ? currentEnd : today;
  const [y, m, d] = base.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Keep the day, clamped to the target month's length (31 Jan + 1 month = 28/29 Feb)
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// Why a member can't check in now, or null when they may. `membership` is their gym_members row
// (or null), `plan` their latest package ({ status, daysLeft } or null), `openVisit` whether they
// are already checked in. A member without a recorded package may check in (many gyms don't
// record packages); an expired, paused or cancelled package may not.
function checkinRefusal({ membership, plan, openVisit }) {
  if (!membership) return "not_member";
  if (membership.status !== "active") return "inactive";
  if (plan && (plan.status !== "active" || (plan.daysLeft !== null && plan.daysLeft < 0))) return "inactive";
  if (openVisit) return "already_in";
  return null;
}

// The front desk's one-line explanation of each refusal
const refusalMessages = {
  invalid: "Invalid QR code. This isn't an justFit member code.",
  expired: "This code has expired. Ask the member to open My QR code again.",
  not_member: "Not a member here. This person isn't a member of this gym.",
  inactive: "Membership not active. This membership is pending, suspended or expired, so they can't check in.",
  already_in: "Already checked in. This member is in the gym now.",
};

module.exports = { renewalFlag, byDaysLeft, lastMonths, renewedEnd, checkinRefusal, refusalMessages };
