// Who hears about what (Gym Hub ecosystem, section 9). Each function is called after the action it
// tells about has been saved; it reads what it needs, writes through service.notify (which never
// throws) and returns nothing. Members are found by their membership's phone = the account's
// verified phone; gym staff by their team row at the branch and the option the event belongs to
// (Role & Permission), so a login hears only about what it may open; admins by role.
const service = require("./service");
const staffRules = require("../gym/staffRules");
const crowdRules = require("../gym/crowdRules");

const safely = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) console.error(`Notification event failed: ${error?.code ?? error?.message ?? "unknown"}`);
  }
};

async function accountsByPhone(db, phone) {
  if (!phone) return [];
  const [rows] = await db.query("SELECT id FROM users WHERE verified_phone = ?", [phone]);
  return rows.map((r) => r.id);
}

// The branch's owner and Staff whose options include `option`
async function teamWith(db, gymId, option) {
  const [rows] = await db.query("SELECT user_id, kind, permissions FROM gym_staff WHERE gym_id = ? AND kind IN ('owner', 'staff')", [gymId]);
  return rows.filter((r) => staffRules.optionsOf(r).includes(option)).map((r) => r.user_id);
}

async function memberRow(db, memberId) {
  const [[row]] = await db.query(
    "SELECT m.id, m.full_name, m.member_code, m.phone, m.gym_id, g.name AS branch, b.name AS brand FROM gym_members m JOIN gyms g ON g.id = m.gym_id JOIN gym_brands b ON b.id = g.brand_id WHERE m.id = ?",
    [memberId],
  );
  return row ?? null;
}

/** A new membership at a gym: the member, and the branch's team that sees members */
const memberAdmitted = safely(async (db, memberId) => {
  const m = await memberRow(db, memberId);
  if (!m) return;
  await service.notify(db, await accountsByPhone(db, m.phone), {
    kind: "membership.activated", key: `${m.id}`, title: `Welcome to ${m.brand}`,
    body: `Your membership at ${m.brand} ${m.branch} is active. Check in with the gym's QR code from Gym Hub.`, link: `/gym-hub/${m.id}`,
  }, { gymId: m.gym_id });
});

/** A member asked for a pause: the member (submitted) and the team that answers pause requests */
const pauseRequested = safely(async (db, memberId, pauseId) => {
  const m = await memberRow(db, memberId);
  if (!m) return;
  await service.notify(db, await accountsByPhone(db, m.phone), {
    kind: "pause.submitted", key: `${pauseId}`, title: "Pause request sent", body: `${m.brand} will approve or reject it. You'll see the answer here.`, link: `/gym-hub/${m.id}`,
  }, { gymId: m.gym_id });
  await service.notify(db, await teamWith(db, m.gym_id, "members.pause"), {
    kind: "pause.request", key: `${pauseId}`, title: "New pause request", body: `${m.full_name} (${m.member_code}) asked to pause their membership.`, link: "/gym/pauses",
  });
});

/** The gym approved or rejected a pause, or paused the membership itself */
const pauseDecided = safely(async (db, pauseId) => {
  const [[p]] = await db.query("SELECT id, member_id, status, requested_by, DATE_FORMAT(pause_from, '%Y-%m-%d') AS f, DATE_FORMAT(pause_until, '%Y-%m-%d') AS u, decision_note FROM gym_membership_pauses WHERE id = ?", [pauseId]);
  if (!p) return;
  const m = await memberRow(db, p.member_id);
  if (!m) return;
  const to = await accountsByPhone(db, m.phone);
  if (p.status === "approved" && p.requested_by === "staff") {
    await service.notify(db, to, { kind: "pause.by_gym", key: `${p.id}`, title: "Membership paused", body: `${m.brand} paused your membership from ${p.f} to ${p.u}. Those days are added to your plan.`, link: `/gym-hub/${m.id}` }, { gymId: m.gym_id });
  } else if (p.status === "approved") {
    await service.notify(db, to, { kind: "pause.approved", key: `${p.id}`, title: "Pause approved", body: `Your pause from ${p.f} to ${p.u} is approved. Those days are added to your plan.`, link: `/gym-hub/${m.id}` }, { gymId: m.gym_id });
  } else if (p.status === "rejected") {
    await service.notify(db, to, { kind: "pause.rejected", key: `${p.id}`, title: "Pause not approved", body: `${m.brand} didn't approve your pause${p.decision_note ? `: “${p.decision_note}”` : "."}`, link: `/gym-hub/${m.id}` }, { gymId: m.gym_id });
  }
});

/** The gym suspended, cancelled or reactivated a membership */
const standingChanged = safely(async (db, memberId, standing, note, changedAt) => {
  const m = await memberRow(db, memberId);
  if (!m) return;
  const words = {
    suspended: ["Membership suspended", `${m.brand} suspended your membership${note ? `: “${note}”` : "."} Check-ins are off until it's reactivated.`],
    cancelled: ["Membership cancelled", `${m.brand} cancelled your membership${note ? `: “${note}”` : "."}`],
    active: ["Membership reactivated", `Your membership at ${m.brand} ${m.branch} is active again.`],
  }[standing];
  if (!words) return;
  await service.notify(db, await accountsByPhone(db, m.phone), {
    kind: standing === "active" ? "membership.reactivated" : `membership.${standing}`, key: `${m.id}:${changedAt}`, title: words[0], body: words[1], link: `/gym-hub/${m.id}`,
  }, { gymId: m.gym_id });
});

/** Someone asked to join from the app: the team that sees enquiries */
const joinRequested = safely(async (db, gymId, enquiryId, name) => {
  await service.notify(db, await teamWith(db, gymId, "enquiries.view"), {
    kind: "gym.join_request", key: `${enquiryId}`, title: "New request to join", body: `${name ?? "A justFit member"} asked about joining through the app.`, link: "/gym/enquiries",
  });
});

/** A gym was submitted for review: every justFit admin */
const gymSubmitted = safely(async (db, gymId) => {
  const [[g]] = await db.query("SELECT g.id, g.name AS branch, g.city, b.name AS brand, g.submitted_at FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ?", [gymId]);
  if (!g) return;
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin'");
  await service.notify(db, admins.map((a) => a.id), {
    kind: "registration.submitted", key: `${g.id}:${new Date(g.submitted_at ?? Date.now()).getTime()}`, title: "Gym waiting for review", body: `${g.brand} (${g.branch}, ${g.city}) was submitted for approval.`, link: `/admin/gyms/${g.id}`,
  });
});

/** justFit decided on a gym: its applicant (and, once it has one, its owner) */
const gymDecided = safely(async (db, gymId, action, note) => {
  const [[g]] = await db.query("SELECT g.id, g.name AS branch, b.name AS brand, b.applicant_id, g.status_changed_at FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ?", [gymId]);
  if (!g) return;
  const [owners] = await db.query("SELECT user_id FROM gym_staff WHERE gym_id = ? AND kind = 'owner'", [gymId]);
  const words = {
    approve: ["Your gym is approved", `${g.brand} is live on justFit. Publish your gym profile so members can find it.`],
    reject: ["Gym not approved", `${g.brand} wasn't approved${note ? `: “${note}”` : "."} You can change the application and send it again.`],
    request_documents: ["More documents needed", note ?? `justFit needs more documents for ${g.brand}.`],
    request_changes: ["Changes needed", note ?? `justFit asked for changes to ${g.brand}'s application.`],
    suspend: ["Gym suspended", `justFit suspended ${g.brand} ${g.branch}${note ? `: “${note}”` : "."}`],
    reactivate: ["Gym reactivated", `${g.brand} ${g.branch} is open on justFit again.`],
  }[action];
  if (!words) return;
  const to = [g.applicant_id, ...owners.map((o) => o.user_id)];
  const link = ["approve", "reactivate", "suspend"].includes(action) && owners.length ? "/gym" : "/gym-register";
  await service.notify(db, to, { kind: "registration.decided", key: `${g.id}:${action}:${new Date(g.status_changed_at ?? Date.now()).getTime()}`, title: words[0], body: words[1], link });
});

/** After a check-in: when the live crowd reaches Busy or Very busy, the team that sees attendance, once an hour per level */
const capacityCheck = safely(async (db, gymId, liveCrowd, today, hour) => {
  if (!liveCrowd?.available || !["busy", "very_busy"].includes(liveCrowd.level)) return;
  await service.notify(db, await teamWith(db, gymId, "attendance.view"), {
    kind: "gym.capacity", key: `${gymId}:${today}:${hour}:${liveCrowd.level}`,
    title: liveCrowd.level === "very_busy" ? "The gym is very busy" : "The gym is getting busy",
    body: `About ${liveCrowd.inside} people inside (${liveCrowd.percent}% of ${liveCrowd.capacity}).`, link: "/gym/attendance",
  });
});

/**
 * The daily round (from the job, after 9 am India time): members whose plan ends in 3 days or ended
 * yesterday, and each branch's team a count of plans ending in the next 3 days. Dedupe keys carry the
 * date, so running it twice a day writes nothing new.
 */
const daily = safely(async (db, today, addDays) => {
  const soon = addDays(today, 3);
  const yesterday = addDays(today, -1);
  const [members] = await db.query(
    `SELECT m.id, m.gym_id, m.phone, DATE_FORMAT(m.expires_on, '%Y-%m-%d') AS ends, b.name AS brand FROM gym_members m JOIN gyms g ON g.id = m.gym_id JOIN gym_brands b ON b.id = g.brand_id
     WHERE m.expires_on IN (?, ?)`,
    [soon, yesterday],
  );
  for (const m of members) {
    const ending = m.ends === soon;
    await service.notify(db, await accountsByPhone(db, m.phone), {
      kind: ending ? "membership.expiring" : "membership.expired", key: `${m.id}:${m.ends}`,
      title: ending ? "Membership ends in 3 days" : "Membership ended",
      body: ending ? `Your ${m.brand} plan ends on ${m.ends}. Renew at the front desk to keep training.` : `Your ${m.brand} plan ended on ${m.ends}. Renew at the front desk.`, link: `/gym-hub/${m.id}`,
    }, { gymId: m.gym_id });
  }
  const [gyms] = await db.query("SELECT gym_id, COUNT(*) AS n FROM gym_members WHERE expires_on BETWEEN ? AND ? GROUP BY gym_id", [today, soon]);
  for (const g of gyms) {
    await service.notify(db, await teamWith(db, g.gym_id, "members.view"), {
      kind: "gym.expiring", key: `${g.gym_id}:${today}`, title: "Memberships ending soon", body: `${g.n} ${Number(g.n) === 1 ? "membership ends" : "memberships end"} in the next 3 days.`, link: "/gym/members",
    });
  }
});

/** Runs the daily round every hour from 9 am to 9 pm India time (the dedupe keys keep it to once a day) */
function startDaily(pool, { everyMs = 60 * 60 * 1000, env = process.env } = {}) {
  if (env.NODE_ENV === "test") return () => {};
  const { todayInIndia, addDays } = require("../gym/rules");
  const run = () => {
    const hour = crowdRules.hourInIndia(Date.now());
    if (hour < 9 || hour > 21) return;
    daily(pool, todayInIndia(), addDays);
  };
  const first = setTimeout(run, 15000);
  const timer = setInterval(run, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { memberAdmitted, pauseRequested, pauseDecided, standingChanged, joinRequested, gymSubmitted, gymDecided, capacityCheck, daily, startDaily };
