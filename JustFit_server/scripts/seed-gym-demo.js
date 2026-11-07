// Demo data for testing the gym portal by hand (added 2026-11-07 at the user's request).
//
//   npm run seed-gym-demo              adds members, payments, enquiries, attendance, catalogue
//                                      items and SMS logs to the first gym (or --gym <id>)
//   npm run seed-gym-demo -- --remove  deletes exactly what it added, nothing else
//
// Every row it writes is tagged ("justFit demo" in the member's and enquiry's notes, "(demo)" at
// the end of a catalogue item's or counter sale's name), so removal finds them again. Real rows
// are never touched. Dates are relative to today in India, so run it the day you test: the
// scenarios (expiring today, overdue, birthdays, today's payments) line up with the dashboard.
// Runs against the database in JustFit_server/.env.
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { pool } = require("../database");
const rules = require("../gym/rules");

const TAG = "justFit demo";
const DEMO_PHONE_START = 7999900001;

// Dates as "YYYY-MM-DD", worked out in UTC so no timezone shifts a day
const parse = (iso) => new Date(`${iso}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => fmt(new Date(parse(iso).getTime() + n * 86400000));
const addMonths = (iso, n) => {
  const d = parse(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmt(d);
};
// The epoch (seconds) of an India-time hour on a date, for FROM_UNIXTIME()
const IST_OFFSET_S = 5.5 * 3600;
const istEpoch = (iso, hour, minute = 0) => parse(iso).getTime() / 1000 + hour * 3600 + minute * 60 - IST_OFFSET_S;

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const gymArg = args.indexOf("--gym");
const gymId = gymArg >= 0 ? Number(args[gymArg + 1]) : null;

async function main() {
  const db = await pool.getConnection();
  try {
    const [[gym]] = await db.query(
      `SELECT g.id, g.name, b.name AS brand, g.next_member_no FROM gyms g JOIN gym_brands b ON b.id = g.brand_id ${gymId ? "WHERE g.id = ?" : "ORDER BY g.id LIMIT 1"}`,
      gymId ? [gymId] : [],
    );
    if (!gym) throw new Error(gymId ? `No gym with id ${gymId}` : "No gym in this database");
    console.log(`Database ${process.env.DB_NAME} · gym ${gym.brand} (${gym.name}), id ${gym.id}`);
    await db.beginTransaction();
    if (remove) await removeDemo(db, gym);
    else await seed(db, gym);
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

async function removeDemo(db, gym) {
  const [members] = await db.query("SELECT id FROM gym_members WHERE gym_id = ? AND notes LIKE ?", [gym.id, `${TAG}%`]);
  const ids = members.map((m) => m.id);
  const [enquiries] = await db.query("SELECT id FROM gym_enquiries WHERE gym_id = ? AND note LIKE ?", [gym.id, `${TAG}%`]);
  const eids = enquiries.map((e) => e.id);
  const counts = {};
  if (ids.length) {
    counts.sms = (await db.query("DELETE FROM gym_sms_log WHERE gym_id = ? AND member_id IN (?)", [gym.id, ids]))[0].affectedRows;
    counts.attendance = (await db.query("DELETE FROM gym_attendance WHERE gym_id = ? AND member_id IN (?)", [gym.id, ids]))[0].affectedRows;
    counts.payments = (await db.query("DELETE FROM gym_payments WHERE gym_id = ? AND member_id IN (?)", [gym.id, ids]))[0].affectedRows;
  }
  counts.counterSales = (await db.query("DELETE FROM gym_payments WHERE gym_id = ? AND member_id IS NULL AND title LIKE '%(demo)'", [gym.id]))[0].affectedRows;
  if (eids.length) {
    counts.contacts = (await db.query("DELETE FROM gym_enquiry_contacts WHERE gym_id = ? AND enquiry_id IN (?)", [gym.id, eids]))[0].affectedRows;
    counts.enquiries = (await db.query("DELETE FROM gym_enquiries WHERE gym_id = ? AND id IN (?)", [gym.id, eids]))[0].affectedRows;
  }
  if (ids.length) counts.members = (await db.query("DELETE FROM gym_members WHERE gym_id = ? AND id IN (?)", [gym.id, ids]))[0].affectedRows;
  counts.catalogue = (await db.query("DELETE FROM gym_catalog_items WHERE gym_id = ? AND name LIKE '%(demo)'", [gym.id]))[0].affectedRows;
  console.log("Removed", counts);
}

async function seed(db, gym) {
  const [[existing]] = await db.query("SELECT COUNT(*) AS n FROM gym_members WHERE gym_id = ? AND notes LIKE ?", [gym.id, `${TAG}%`]);
  if (existing.n) throw new Error(`Demo data is already there (${existing.n} members). Run with --remove first.`);
  const [[owner]] = await db.query("SELECT user_id FROM gym_staff WHERE gym_id = ? AND kind = 'owner' LIMIT 1", [gym.id]);
  const by = owner?.user_id ?? null;
  const today = rules.todayInIndia();
  const d = (n) => addDays(today, n);
  const thisYear = Number(today.slice(0, 4));
  const bday = (yearsAgo, offsetDays = 0) => `${thisYear - yearsAgo}-${d(offsetDays).slice(5)}`;

  // ---- Catalogue: plans, PT, services, products ----
  const catalogue = [
    { kind: "plan", name: "Monthly (demo)", duration: 1, unit: "months", price: 1500 },
    { kind: "plan", name: "Quarterly (demo)", duration: 3, unit: "months", price: 4000 },
    { kind: "plan", name: "Half-yearly (demo)", duration: 6, unit: "months", price: 7000 },
    { kind: "plan", name: "Annual (demo)", duration: 12, unit: "months", price: 12000 },
    { kind: "plan", name: "15-day trial (demo)", duration: 15, unit: "days", price: 800 },
    { kind: "pt", name: "PT 12 sessions (demo)", duration: 1, unit: "months", price: 3500 },
    { kind: "pt", name: "PT 3 months (demo)", duration: 3, unit: "months", price: 9000 },
    { kind: "service", name: "Diet consultation (demo)", price: 600 },
    { kind: "service", name: "Body composition scan (demo)", price: 300 },
    { kind: "product", name: "Whey protein 1 kg (demo)", price: 2400, stock: 12 },
    { kind: "product", name: "Shaker bottle (demo)", price: 350, stock: 2 },
    { kind: "product", name: "Gym gloves (demo)", price: 500, stock: 0 },
    { kind: "product", name: "Energy bar (demo)", price: 80 },
  ];
  for (const c of catalogue) {
    await db.query(
      "INSERT INTO gym_catalog_items (gym_id, kind, name, duration, duration_unit, price, stock, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [gym.id, c.kind, c.name, c.duration ?? null, c.unit ?? null, c.price, c.stock ?? null, by],
    );
  }

  // ---- Members: one scenario each ----
  // joined: days ago; months: plan length; due/dueBy: what they owe and by when (days from today);
  // pt: [from, until] days from today; dob: a date of birth; late: how many due payments they paid late
  const members = [
    { name: "Arjun Reddy", gender: "male", joined: -200, months: 12, visits: "regular", dob: bday(28) },
    { name: "Priya Sharma", gender: "female", joined: -45, months: 3, visits: "regular", pt: [-20, 10], dob: bday(31, 0) },
    { name: "Rahul Verma", gender: "male", joined: -60, months: 2, visits: "regular", dob: bday(24, 0) },
    { name: "Sneha Patil", gender: "female", joined: -90, months: 3, visits: "dropping" },
    { name: "Vikram Singh", gender: "male", joined: -89, months: 3, visits: "none" },
    { name: "Ananya Iyer", gender: "female", joined: -88, months: 3, visits: "regular", pt: [-10, 20] },
    { name: "Karthik Rao", gender: "male", joined: -87, months: 3, visits: "dropping", due: 1500, dueBy: 5 },
    { name: "Divya Nair", gender: "female", joined: -35, months: 1, visits: "none", due: 2500, dueBy: -3, late: 2 },
    { name: "Manoj Kumar", gender: "male", joined: -92, months: 3, visits: "regular", dob: bday(35, 3) },
    { name: "Pooja Hegde", gender: "female", joined: -100, months: 3, visits: "none", due: 800, dueBy: -12 },
    { name: "Suresh Gowda", gender: "male", joined: -120, months: 3, visits: "none" },
    { name: "Lakshmi Devi", gender: "female", joined: -150, months: 3, visits: "none", due: 3200, dueBy: -40 },
    { name: "Nikhil Jain", gender: "male", joined: -40, months: 6, visits: "regular", due: 1000, dueBy: 10 },
    { name: "Meghana Shetty", gender: "female", joined: -20, months: 1, visits: "regular", due: 500, dueBy: 2 },
    { name: "Rohan Das", gender: "male", joined: -10, months: 1, visits: "regular", pt: [-10, 20] },
    { name: "Kavya Krishnan", gender: "female", joined: -5, months: 3, visits: "regular", dob: bday(22, 10) },
    { name: "Aditya Menon", gender: "male", joined: -2, months: 12, visits: "regular" },
    { name: "Shruti Bhat", gender: "female", joined: 0, months: 3, visits: "regular", due: 1000, dueBy: 7 },
    { name: "Harish Kulkarni", gender: "male", joined: 0, months: 1, visits: "none" },
    { name: "Deepa Raj", gender: "female", joined: -75, days: 90, visits: "regular" },
    { name: "Sanjay Pillai", gender: "male", joined: -30, months: 2, visits: "regular", pt: [-30, 0], late: 2, due: 2200, dueBy: -1 },
    { name: "Nandini Rao", gender: "female", joined: -365, months: 12, visits: "regular", dob: bday(40, 0) },
  ];
  const plans = { 1: "Monthly", 2: "2 Months", 3: "Quarterly", 6: "Half-yearly", 12: "Annual" };
  const ids = [];
  let number = gym.next_member_no;
  let phone = DEMO_PHONE_START;
  for (const m of members) {
    const joinedOn = d(m.joined);
    const expiresOn = m.days ? addDays(joinedOn, m.days) : addMonths(joinedOn, m.months);
    const code = rules.memberCode(gym.brand, gym.name, number++);
    const [res] = await db.query(
      `INSERT INTO gym_members (gym_id, member_code, full_name, phone, dob, gender, email, height_cm, weight_kg, notes, plan_months, plan_days, joined_on, expires_on, due_amount, due_by, pt_label, pt_from, pt_until, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gym.id, code, m.name, String(phone++), m.dob ?? null, m.gender, `${m.name.split(" ")[0].toLowerCase()}@demo.justfit.test`,
        m.gender === "female" ? 160 : 172, m.gender === "female" ? 58 : 72, `${TAG}: ${m.visits} visits`,
        m.days ? null : m.months, m.days ?? null, joinedOn, expiresOn, m.due ?? 0, m.due ? d(m.dueBy) : null,
        m.pt ? "PT 12 sessions" : null, m.pt ? d(m.pt[0]) : null, m.pt ? d(m.pt[1]) : null, by,
      ],
    );
    const id = res.insertId;
    ids.push({ id, ...m, joinedOn, expiresOn });
    const planText = m.days ? `${m.days} Days` : plans[m.months];
    const method = (n) => (n % 2 ? "cash" : "online");
    // Admission when they joined, renewals every plan length since (for the 1-year members)
    await db.query(
      "INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, 'admission', ?, ?, ?, ?, ?, ?)",
      [gym.id, id, m.name, planText, method(id), m.months === 12 ? 12000 : m.months === 6 ? 7000 : m.months === 3 ? 4000 : 1500, joinedOn, by],
    );
    if (m.joined <= -365) {
      await db.query(
        "INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, 'renewal', ?, ?, 'online', 12000, ?, ?)",
        [gym.id, id, m.name, planText, d(-1), by],
      );
    }
    if (m.pt) {
      await db.query(
        "INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, 'pt', ?, 'PT · 12 sessions · 1 Month', 'cash', 3500, ?, ?)",
        [gym.id, id, m.name, m.pt[0] === -30 ? d(-30) : d(0), by],
      );
    }
    // Due payments paid late (for "Payment on time"): due 5 days before they paid, twice
    for (let i = 0; i < (m.late ?? 0); i++) {
      const paidOn = d(-20 - i * 25);
      await db.query(
        "INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, due_by, created_by) VALUES (?, ?, 'due', ?, 'Due payment', 'cash', 1000, ?, ?, ?)",
        [gym.id, id, m.name, paidOn, addDays(paidOn, -5), by],
      );
    }
  }
  const byName = (name) => ids.find((m) => m.name === name);
  // Today's other money: a due paid on time, a renewal, a product and a service to a member
  await db.query("INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, due_by, created_by) VALUES (?, ?, 'due', ?, 'Due payment', 'online', 1500, ?, ?, ?)", [gym.id, byName("Nikhil Jain").id, "Nikhil Jain", today, d(3), by]);
  await db.query("INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, 'renewal', ?, 'Quarterly', 'online', 4000, ?, ?)", [gym.id, byName("Manoj Kumar").id, "Manoj Kumar", today, by]);
  await db.query("INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, 'sale', ?, 'Whey protein 1 kg × 1', 'online', 2400, ?, ?)", [gym.id, byName("Arjun Reddy").id, "Arjun Reddy", today, by]);
  await db.query("INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, 'service', ?, 'Diet consultation', 'cash', 600, ?, ?)", [gym.id, byName("Priya Sharma").id, "Priya Sharma", d(-1), by]);
  // Renewals over the last 90 days (the renewal rate) and some counter sales for the wallet
  for (const [name, daysAgo] of [["Sneha Patil", -1], ["Ananya Iyer", -2], ["Karthik Rao", -3], ["Deepa Raj", -75]]) {
    await db.query("INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, 'renewal', ?, 'Quarterly', 'cash', 4000, ?, ?)", [gym.id, byName(name).id, name, d(daysAgo - 90), by]);
  }
  for (const [title, amount, daysAgo] of [["Energy bar (demo)", 160, 0], ["Shaker bottle (demo)", 350, -4], ["Gym gloves (demo)", 500, -15], ["Whey protein 1 kg (demo)", 2400, -40]]) {
    await db.query("INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, NULL, 'sale', ?, 'Counter sale', 'cash', ?, ?, ?)", [gym.id, title, amount, d(daysAgo), by]);
  }

  // ---- Attendance: five weeks of visits with morning and evening peaks ----
  // "regular": most weekdays; "dropping": the older weeks only; "none": nothing in the last 2 weeks
  let visits = 0;
  for (const m of ids) {
    for (let daysAgo = 35; daysAgo >= 0; daysAgo--) {
      const date = d(-daysAgo);
      if (date < m.joinedOn) continue;
      const seed = (m.id * 7 + daysAgo * 13) % 10;
      // Sundays are quiet: about a third of the usual crowd
      if (parse(date).getUTCDay() === 0 && seed % 3) continue;
      const comes = m.visits === "regular" ? seed < 7 : m.visits === "dropping" ? (daysAgo > 14 ? seed < 7 : seed < 2) : daysAgo > 14 && seed < 5;
      if (!comes) continue;
      const hour = seed % 2 ? 6 + (seed % 3) : 18 + (seed % 3);
      const inAt = istEpoch(date, hour, (m.id * 11) % 60);
      const duration = 50 + ((m.id + daysAgo) % 5) * 10;
      const inside = daysAgo === 0 && seed < 3 && hour < 18;
      const noCheckout = !inside && seed === 6;
      await db.query(
        `INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, checked_out_at, status, duration_min, in_source, out_source, created_by)
         VALUES (?, ?, ?, FROM_UNIXTIME(?), ${inside || noCheckout ? "NULL" : "FROM_UNIXTIME(?)"}, ?, ?, ?, ?, ?)`,
        inside || noCheckout
          ? [gym.id, m.id, date, inAt, inside ? "inside" : "no_checkout", null, seed < 5 ? "qr" : "staff", null, by]
          : [gym.id, m.id, date, inAt, inAt + duration * 60, "completed", duration, seed < 5 ? "qr" : "staff", seed < 5 ? "qr" : "staff", by],
      );
      visits++;
    }
  }

  // ---- Enquiries: every list, with contact attempts for the Hot / Warm / Cold score ----
  const enquiries = [
    { name: "Tejas Hiremath", status: "new", enquired: 0, interest: "membership", source: "walk_in", contacts: [] },
    { name: "Ramya Bhat", status: "follow_up", enquired: 0, follow: 0, interest: "trial", source: "instagram", contacts: [["call", "reached", 0]] },
    { name: "Girish Naik", status: "follow_up", enquired: -1, follow: 0, interest: "pt", source: "referral", contacts: [["whatsapp", "reached", -1], ["visit", "visited", 0]] },
    { name: "Swathi Kulkarni", status: "follow_up", enquired: -5, follow: -2, interest: "membership", source: "call", contacts: [["call", "no_answer", -4], ["call", "no_answer", -3]] },
    { name: "Prakash Shetty", status: "follow_up", enquired: -10, follow: -6, interest: "membership", source: "whatsapp", contacts: [["whatsapp", "no_answer", -9]] },
    { name: "Bhavana Gowda", status: "new", enquired: -3, interest: "trial", source: "walk_in", contacts: [] },
    { name: "Mahesh Patil", status: "follow_up", enquired: -20, follow: 3, interest: "other", source: "other", contacts: [["call", "reached", -18]] },
    { name: "Anjali Rao", status: "follow_up", enquired: -2, follow: 1, interest: "pt", source: "referral", contacts: [["call", "reached", -1]] },
    { name: "Sunil Hegde", status: "lost", enquired: -15, interest: "membership", source: "call", contacts: [["call", "reached", -14]] },
    { name: "Kavya Krishnan", status: "joined", enquired: -8, interest: "membership", source: "instagram", member: "Kavya Krishnan", contacts: [["visit", "visited", -6]] },
    { name: "Aditya Menon", status: "joined", enquired: -4, interest: "membership", source: "walk_in", member: "Aditya Menon", contacts: [] },
    { name: "Nithya Suresh", status: "new", enquired: -30, interest: "trial", source: "whatsapp", contacts: [] },
  ];
  let ephone = DEMO_PHONE_START + 500;
  for (const e of enquiries) {
    const [res] = await db.query(
      "INSERT INTO gym_enquiries (gym_id, full_name, phone, note, status, follow_up_on, interest, source, member_id, enquired_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [gym.id, e.name, String(ephone++), `${TAG}: asked about ${e.interest}`, e.status, e.follow === undefined ? null : d(e.follow), e.interest, e.source, e.member ? byName(e.member).id : null, d(e.enquired), by],
    );
    for (const [kind, outcome, daysAgo] of e.contacts) {
      await db.query("INSERT INTO gym_enquiry_contacts (gym_id, enquiry_id, kind, outcome, contacted_on, created_by) VALUES (?, ?, ?, ?, ?, ?)", [gym.id, res.insertId, kind, outcome, d(daysAgo), by]);
    }
  }

  // ---- SMS logs: a few sent and failed rows for Message Logs ----
  const smsRows = [
    ["Divya Nair", "due", "manual", "sent", 1, null],
    ["Pooja Hegde", "expired", "auto", "sent", 1, "expired:" + d(-10)],
    ["Priya Sharma", "birthday", "auto", "sent", 1, "birthday:" + thisYear],
    ["Lakshmi Devi", "due", "manual", "failed", 0, "provider 400"],
    ["Meghana Shetty", "expiry", "auto", "sent", 1, "expiry:" + d(2)],
  ];
  for (const [name, kind, source, status, credits, extra] of smsRows) {
    await db.query(
      "INSERT INTO gym_sms_log (gym_id, member_id, kind, source, status, body, credits, auto_key, error, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [gym.id, byName(name).id, kind, source, status, `Hi ${name.split(" ")[0]}, a ${kind} reminder from ${gym.brand} (${gym.name}). [demo]`, credits, source === "auto" ? extra : null, status === "failed" ? extra : null, by],
    );
  }

  await db.query("UPDATE gyms SET next_member_no = ? WHERE id = ?", [number, gym.id]);
  console.log(`Added ${members.length} members, ${catalogue.length} catalogue items, ${enquiries.length} enquiries, ${visits} visits and ${smsRows.length} SMS logs for ${today}.`);
  console.log("Remove them later with: npm run seed-gym-demo -- --remove");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
