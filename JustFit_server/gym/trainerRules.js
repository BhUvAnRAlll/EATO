// A gym trainer's PT clients (pure, unit-tested): which members a trainer sees and what of them.
// A trainer sees only the gym members whose PT is with them (gym_members.pt_trainer_id), at branches
// where they are a trainer, while that PT runs and for 30 days after it ends. No money: never the
// fees, dues or payments.
const ENDED_DAYS_SHOWN = 30;

const dayMs = 86400000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

// The first day still shown: PT that ended before this is gone from the list
function oldestShown(today) {
  return new Date(Date.parse(`${today}T00:00:00Z`) - ENDED_DAYS_SHOWN * dayMs).toISOString().slice(0, 10);
}

// One client as the trainer sees them. row: the gym_members columns the query reads, plus the branch
function clientOf(row, today, toE164) {
  const daysLeft = daysBetween(today, row.pt_until);
  return {
    id: row.id,
    code: row.member_code,
    name: row.full_name,
    phone: toE164(row.phone),
    photoUrl: row.photo_key ? `/api/trainer/clients/${row.id}/photo?v=${row.photo_key.slice(0, 8)}` : null,
    branch: row.branch,
    pt: { label: row.pt_label, from: row.pt_from, until: row.pt_until, active: daysLeft >= 0, daysLeft },
    inToday: Boolean(row.in_today),
  };
}

// Active PT first (the soonest to end first), then ended PT (the most recent first)
function sortClients(clients) {
  return [...clients].sort((a, b) => {
    if (a.pt.active !== b.pt.active) return a.pt.active ? -1 : 1;
    if (a.pt.daysLeft !== b.pt.daysLeft) return a.pt.active ? a.pt.daysLeft - b.pt.daysLeft : b.pt.daysLeft - a.pt.daysLeft;
    return a.name.localeCompare(b.name);
  });
}

module.exports = { ENDED_DAYS_SHOWN, oldestShown, clientOf, sortClients, daysBetween };
