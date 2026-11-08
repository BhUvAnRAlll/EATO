// The gym portal's SMS to members: the branch's credits (1 credit = 1 SMS, added by the justFit
// team), the Auto Reminders switches, Manual Send to a group, one reminder from the member list,
// the Message Logs, and the hourly job that sends the switched-on reminders. Every function works
// on the branch the route worked out from the signed-in staff account (req.gym), never one from
// the request. The rules and the message texts are in smsRules.js, the provider in smsSender.js.
//
// Sending one message: a credit is taken and the log row written in one transaction (no credit,
// no send), then the provider is called; if it fails the credit goes back and the row says so.
const { NotFoundError, ConflictError } = require("../errors");
const gymRules = require("./rules");
const rules = require("./smsRules");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
const MEMBER_COLUMNS = `m.id, m.full_name, m.phone, m.member_code, ${DAY("m.expires_on")} AS expires_on, m.due_amount`;
const LOG_PAGE = 30;
const CONCURRENCY = 4;

// Who each Manual Send group and each auto reminder reaches (members with a mobile number)
const GROUP_WHERE = {
  expiring: (today) => ["m.expires_on BETWEEN ? AND ?", [today, gymRules.addDays(today, 3)]],
  expired: (today) => ["m.expires_on BETWEEN ? AND ?", [gymRules.addDays(today, -30), gymRules.addDays(today, -1)]],
  due: () => ["m.due_amount > 0", []],
  birthday: (today) => ["DATE_FORMAT(m.dob, '%m-%d') = ?", [today.slice(5)]],
};
const AUTO_WHERE = {
  expiry: (today) => ["m.expires_on = ?", [gymRules.addDays(today, 1)]],
  expired: (today) => ["m.expires_on = ?", [gymRules.addDays(today, -3)]],
  due: GROUP_WHERE.due,
  birthday: GROUP_WHERE.birthday,
};

async function inTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

// One message to one member. Returns "sent", "failed", "no_credits" or "duplicate" (an auto
// reminder that already went).
async function sendOne(pool, sender, gym, member, kind, { source, userId = null, autoKey = null }) {
  const values = rules.variablesFor(kind, member, gym);
  const body = rules.render(kind, values);
  let logId;
  try {
    logId = await inTransaction(pool, async (db) => {
      const [taken] = await db.query("UPDATE gyms SET sms_credits = sms_credits - 1 WHERE id = ? AND sms_credits >= 1", [gym.id]);
      if (taken.affectedRows === 0) return null;
      const [row] = await db.query(
        "INSERT INTO gym_sms_log (gym_id, member_id, kind, source, status, body, credits, auto_key, sent_by) VALUES (?, ?, ?, ?, 'sending', ?, 1, ?, ?)",
        [gym.id, member.id, kind, source, body, autoKey, userId],
      );
      return row.insertId;
    });
  } catch (error) {
    // An auto reminder that already went: the transaction rolled back, so the credit stays
    if (error?.code === "ER_DUP_ENTRY") return "duplicate";
    throw error;
  }
  if (!logId) return "no_credits";
  try {
    await sender.send(member.phone, kind, values);
    await pool.query("UPDATE gym_sms_log SET status = 'sent' WHERE id = ?", [logId]);
    return "sent";
  } catch (error) {
    await inTransaction(pool, async (db) => {
      await db.query("UPDATE gym_sms_log SET status = 'failed', credits = 0, error = ? WHERE id = ?", [String(error?.reason ?? "error").slice(0, 40), logId]);
      await db.query("UPDATE gyms SET sms_credits = sms_credits + 1 WHERE id = ?", [gym.id]);
    });
    return "failed";
  }
}

// Sends to a list a few at a time; counts what happened
async function sendAll(pool, sender, gym, members, kind, options) {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  let next = 0;
  const worker = async () => {
    while (next < members.length) {
      const member = members[next++];
      const outcome = await sendOne(pool, sender, gym, member, kind, typeof options === "function" ? options(member) : options);
      if (outcome === "sent") counts.sent++;
      else if (outcome === "failed") counts.failed++;
      else counts.skipped++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, members.length) }, worker));
  return counts;
}

async function credits(pool, gymId) {
  const [[row]] = await pool.query("SELECT sms_credits FROM gyms WHERE id = ?", [gymId]);
  return row?.sms_credits ?? 0;
}

async function groupCounts(pool, gymId, today) {
  const out = [];
  for (const [id, group] of Object.entries(rules.GROUPS)) {
    const [where, params] = GROUP_WHERE[id](today);
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM gym_members m WHERE m.gym_id = ? AND m.phone IS NOT NULL AND ${where}`, [gymId, ...params]);
    out.push({ id, label: group.label, kind: group.kind, count: Math.min(row.n, rules.MAX_RECIPIENTS) });
  }
  return out;
}

// Send Bulk SMS: the balance, whether sending is on, the reminders with their switches and
// previews, and the Manual Send groups with how many members each would reach
async function overview(pool, gym, sender, today) {
  const [rows] = await pool.query("SELECT kind, enabled FROM gym_sms_settings WHERE gym_id = ?", [gym.id]);
  const on = Object.fromEntries(rows.map((r) => [r.kind, Boolean(r.enabled)]));
  return {
    credits: await credits(pool, gym.id),
    sending: sender.enabled,
    reminders: rules.KINDS.map((kind) => ({ kind, ...rules.AUTO[kind], on: on[kind] ?? false, preview: rules.preview(kind, gym, today) })),
    groups: await groupCounts(pool, gym.id, today),
  };
}

async function updateSettings(pool, gym, userId, changes, sender, today) {
  // All the switches in one transaction: a failure part-way leaves none of them changed
  await inTransaction(pool, async (db) => {
    for (const [kind, enabled] of Object.entries(changes)) {
      await db.query(
        "INSERT INTO gym_sms_settings (gym_id, kind, enabled, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)",
        [gym.id, kind, enabled ? 1 : 0, userId],
      );
    }
  });
  return overview(pool, gym, sender, today);
}

// Safe messages with their own status (the shared handler answers with both)
const statusError = (status, message) => Object.assign(new ConflictError(message), { status });
const notOn = () => statusError(503, "SMS sending isn't switched on for justFit yet.");
const noCredits = () => new ConflictError("You have no SMS credits left. Ask the justFit team to add more.");

// One manual send per branch at a time (in this process), so a double tap can't send twice
const busy = new Set();

async function sendToGroup(pool, gym, userId, sender, group, today) {
  if (!sender.enabled) throw notOn();
  if (busy.has(gym.id)) throw new ConflictError("A send is already running. Please wait for it to finish.");
  busy.add(gym.id);
  try {
    if ((await credits(pool, gym.id)) < 1) throw noCredits();
    const [where, params] = GROUP_WHERE[group](today);
    const [members] = await pool.query(
      `SELECT ${MEMBER_COLUMNS} FROM gym_members m WHERE m.gym_id = ? AND m.phone IS NOT NULL AND ${where} ORDER BY m.full_name, m.id LIMIT ?`,
      [gym.id, ...params, rules.MAX_RECIPIENTS],
    );
    const counts = await sendAll(pool, sender, gym, members, rules.GROUPS[group].kind, { source: "manual", userId });
    return { ...counts, credits: await credits(pool, gym.id) };
  } finally {
    busy.delete(gym.id);
  }
}

async function sendToMember(pool, gym, userId, sender, memberId, kind) {
  if (!sender.enabled) throw notOn();
  const [[member]] = await pool.query(`SELECT ${MEMBER_COLUMNS} FROM gym_members m WHERE m.id = ? AND m.gym_id = ?`, [memberId, gym.id]);
  if (!member) throw new NotFoundError("That member isn't at your gym.");
  if (!member.phone) throw new ConflictError("Add the member's mobile number to text them.");
  if (kind === "due" && member.due_amount <= 0) throw new ConflictError("This member has no dues.");
  const outcome = await sendOne(pool, sender, gym, member, kind, { source: "manual", userId });
  if (outcome === "no_credits") throw noCredits();
  if (outcome === "failed") throw statusError(502, "The SMS couldn't be sent. Your credit was given back. Please try again.");
  return { sent: 1, credits: await credits(pool, gym.id) };
}

async function logs(pool, gymId, { before }) {
  const [rows] = await pool.query(
    `SELECT l.id, l.kind, l.source, l.status, l.body, l.created_at, m.full_name, m.member_code
     FROM gym_sms_log l JOIN gym_members m ON m.id = l.member_id
     WHERE l.gym_id = ?${before ? " AND l.id < ?" : ""} ORDER BY l.id DESC LIMIT ?`,
    before ? [gymId, before, LOG_PAGE + 1] : [gymId, LOG_PAGE + 1],
  );
  const page = rows.slice(0, LOG_PAGE);
  return {
    logs: page.map((r) => ({ id: r.id, name: r.full_name, code: r.member_code, kind: r.kind, source: r.source, status: r.status, text: r.body, at: new Date(r.created_at).toISOString() })),
    next: rows.length > LOG_PAGE ? page[page.length - 1].id : null,
  };
}

// The hourly job: every switched-on reminder of every branch with credits, each member once
// (the auto_key's unique index makes a second run, or a second server, skip them)
async function runAutoReminders(pool, sender, today) {
  if (!sender.enabled) return { sent: 0, failed: 0, skipped: 0 };
  const [jobs] = await pool.query(
    `SELECT s.kind, g.id, g.name AS branch, b.name AS brand FROM gym_sms_settings s
     JOIN gyms g ON g.id = s.gym_id JOIN gym_brands b ON b.id = g.brand_id
     WHERE s.enabled = 1 AND g.sms_credits > 0 ORDER BY g.id, FIELD(s.kind, 'expiry', 'expired', 'due', 'birthday')`,
  );
  const total = { sent: 0, failed: 0, skipped: 0 };
  for (const job of jobs) {
    const gym = { id: job.id, branch: job.branch, brand: job.brand };
    const [where, params] = AUTO_WHERE[job.kind](today);
    // The key is the same for everyone in this query (one plan end date, week or year)
    const key = rules.autoKey(job.kind, { expires_on: params[0] }, today);
    const [members] = await pool.query(
      `SELECT ${MEMBER_COLUMNS} FROM gym_members m WHERE m.gym_id = ? AND m.phone IS NOT NULL AND ${where}
         AND NOT EXISTS (SELECT 1 FROM gym_sms_log l WHERE l.member_id = m.id AND l.auto_key = ?)
       ORDER BY m.id LIMIT 500`,
      [gym.id, ...params, key],
    );
    const counts = await sendAll(pool, sender, gym, members, job.kind, (member) => ({ source: "auto", autoKey: rules.autoKey(job.kind, member, today) }));
    for (const k of Object.keys(total)) total[k] += counts[k];
  }
  return total;
}

// Every hour in the daytime (India time); never in tests, which run the job themselves
function startReminders(pool, sender, { everyMs = 60 * 60 * 1000, log = console, env = process.env } = {}) {
  if (!sender.enabled || env.NODE_ENV === "test") return () => {};
  let warned = false;
  const run = () => {
    if (!rules.reminderHour()) return;
    runAutoReminders(pool, sender, gymRules.todayInIndia())
      .then(({ sent, failed }) => { if (sent + failed > 0) log.log(`Gym reminders: ${sent} sent, ${failed} failed`); })
      .catch((error) => {
        if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
          if (!warned) log.warn("Gym reminders skipped: run migrations/2026-11-25-gym-sms.sql");
          warned = true;
          return;
        }
        log.error(`Gym reminders failed: ${error?.code ?? error?.name ?? "unknown"}`);
      });
  };
  const first = setTimeout(run, 10000);
  const timer = setInterval(run, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

// Super Admin › a gym › Add SMS credits
async function addCredits(pool, gymId, amount) {
  const [result] = await pool.query("UPDATE gyms SET sms_credits = LEAST(sms_credits + ?, 10000000) WHERE id = ?", [amount, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That gym doesn't exist.");
}

module.exports = { overview, updateSettings, sendToGroup, sendToMember, logs, runAutoReminders, startReminders, addCredits, credits };
