// Activity log's rules (pure, unit-tested; 2026-11-09, the user's request): which gym portal
// request is which change, what it was made to, and the line that says what changed. The gym
// admin reads the log on ☰ › Activity: "Ravi · Staff edited member Arjun M (FOR-TUM-0003):
// weight, address". gym/activity.js records it; every write route under /api/gym must be listed
// here (gym-activity-rules.test.js walks the router), so a new route can't go unrecorded.
const { ValidationError } = require("../profile");
const { maskPhone } = require("./staffRules");

const ACTIONS = ["create", "edit", "delete"];
const TYPES = ["member", "payment", "enquiry", "catalog", "expense", "pause", "attendance", "sms", "template", "settings", "team"];
const KEEP_DAYS = 365;
const PAGE_SIZE = 50;

const rupees = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
const MODE = { online: "online", cash: "cash" };
const CATALOG_KIND = { plan: "Plan", pt: "PT package", service: "Service", product: "Product" };
const EXPENSE_CATEGORY = {
  rent: "Rent", salary: "Salary", electricity: "Electricity", water: "Water", equipment: "Equipment",
  maintenance: "Maintenance", cleaning: "Cleaning", marketing: "Marketing", stock: "Stock", other: "Other",
};
const SMS_GROUP = { expiring: "members expiring in 3 days", expired: "members expired in the last 30 days", due: "members with a payment due", birthday: "today's birthdays" };
const TEMPLATE_KIND = { due: "Payment due", expiry: "Membership expiring", expired: "Membership expired", enquiry: "Enquiry follow-up" };
const STATUS = { new: "New", follow_up: "Follow-up", joined: "Joined", lost: "Not interested" };

// What an edit's line names for each kind of record: [column, words, how to show the values].
// show: false names the field only (personal details: a phone, an address, a note never go into
// the log); a function shows "old → new" (prices, amounts, dates, statuses: the business record).
const day = (v) => (v ? String(v).slice(0, 10) : "none");
const plain = (v) => (v === null || v === undefined || v === "" ? "none" : String(v));
const money = (v) => (v === null || v === undefined ? "none" : rupees(v));
const FIELDS = {
  member: [
    ["full_name", "name", false], ["phone", "mobile", false], ["gender", "gender", false], ["dob", "date of birth", false],
    ["email", "email", false], ["height_cm", "height", false], ["weight_kg", "weight", false], ["address", "address", false],
    ["notes", "notes", false], ["pt_trainer_id", "PT trainer", false], ["photo_key", "photo", false],
  ],
  enquiry: [
    ["full_name", "name", false], ["phone", "mobile", false], ["note", "note", false],
    ["status", "status", (v) => STATUS[v] ?? plain(v)], ["follow_up_on", "follow-up date", day],
    ["interest", "interest", plain], ["source", "came from", plain], ["referred_by_phone", "referrer", false], ["member_id", "linked member", false],
  ],
  catalog: [["name", "name", plain], ["duration", "duration", plain], ["price", "price", money], ["stock", "stock", plain], ["image_key", "image", false]],
  expense: [
    ["category", "category", (v) => EXPENSE_CATEGORY[v] ?? plain(v)], ["title", "for", plain], ["paid_to", "paid to", false],
    ["method", "mode", plain], ["amount", "amount", money], ["spent_on", "date", day], ["note", "note", false], ["bill_key", "bill", false],
  ],
};

// A value as compared: dates by their day, numbers and decimals as text, empty as null
const comparable = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined || v === "" ? null : String(v));

// "Changed: weight, address" / "Changed: price ₹1,500 → ₹1,800, stock". null when nothing changed.
function changes(type, before, after) {
  if (!before || !after || !FIELDS[type]) return null;
  const parts = [];
  for (const [column, words, show] of FIELDS[type]) {
    const a = comparable(before[column]);
    const b = comparable(after[column]);
    if (a === b) continue;
    parts.push(show ? `${words} ${show(a)} → ${show(b)}` : words);
  }
  return parts.length ? `Changed: ${parts.join(", ")}` : "Saved with no changes";
}

// What a record is called in the log, from its row (kept as it was, so a deleted one still reads)
function labelOf(type, row) {
  if (!row) return null;
  switch (type) {
    case "member":
    case "pause":
      return row.member_code ? `${row.full_name} (${row.member_code})` : row.full_name ?? null;
    case "enquiry":
      return row.full_name ?? null;
    case "catalog":
      return row.name ? `${CATALOG_KIND[row.kind] ?? "Item"} ${row.name}` : null;
    case "expense":
      return row.title || EXPENSE_CATEGORY[row.category] || null;
    case "payment":
      return row.title ? `${row.title} · ${row.detail}` : null;
    case "template":
      return row.name ?? null;
    case "team":
      return (row.full_name && row.full_name.trim()) || maskPhone(row.verified_phone ?? row.phone) || null;
    default:
      return null;
  }
}

const paidLine = (amount, method) => [amount ? rupees(amount) : null, MODE[method] ?? null].filter(Boolean).join(" · ") || null;

// Every write under /api/gym: [methods, path, entry]. The path is read lower-cased without a
// trailing slash; a capture group is the record's id. entry: { type, action, target (the table its
// label and before / after rows come from), label (for an add, from the request or the answer),
// detail (the line) } or null for a request that changes nothing (switching branch).
// ctx: { body, answer, before, after, extra: { item } }
const R = (methods, path, entry) => [methods, path, entry];
// The Gym Profile draft's fields as Activity names them (never their values: contacts are personal)
const PROFILE_FIELD = {
  about: "description", facilities: "facilities", custom: "own facilities", hours: "opening hours", closures: "closures",
  show: "what members see", whatsapp: "WhatsApp number", email: "email", website: "website", instagram: "Instagram", facebook: "Facebook",
};
// Gym Profile phase 2: what a catalogue edit changed beyond the snapshot's columns
const CATALOG_KIND_LABEL = { plan: "Membership plans", pt: "PT packages", service: "Services", product: "Products" };
const STATUS_WORD = { active: "Made it active", inactive: "Made it inactive", archived: "Archived it" };
function catalogExtras(body) {
  const parts = [];
  if (body?.status !== undefined) parts.push(STATUS_WORD[body.status] ?? "Changed its status");
  if (body?.bestValue === true) parts.push("Marked it best value");
  if (body?.bestValue === false) parts.push("Unmarked best value");
  if (body?.benefits !== undefined) parts.push("Changed the benefits");
  return parts.join(" · ") || null;
}
const ROUTES = [
  R(["POST"], /^\/branch$/, null),
  // Arranging Home's Today tiles is the login's own view, nothing to record
  R(["PUT"], /^\/home-tiles$/, null),
  R(["POST"], /^\/branches$/, { type: "settings", action: "create", label: () => "Branches", detail: ({ body }) => `Added the ${body?.branch ?? "new"} branch` }),
  R(["PATCH"], /^\/details$/, { type: "settings", action: "edit", label: () => "Branch details", detail: () => "Changed the branch's name or place" }),
  // Staff / Admin Login (the gym admin's own team changes)
  R(["POST"], /^\/staff$/, { type: "team", action: "create", label: ({ body }) => maskPhone(String(body?.phone ?? "").replace(/\D/g, "").slice(-10)) ?? "A mobile number", detail: ({ body, answer }) => `${answer?.result === "invited" ? "Invited" : "Added"} as ${body?.kind === "trainer" ? "Trainer" : "Staff"}${answer?.branch ? ` at ${answer.branch}` : ""}` }),
  R(["PUT"], /^\/staff\/([^/]+)\/permissions$/, { type: "team", action: "edit", target: "team", detail: () => "Changed Role & Permission" }),
  R(["PUT"], /^\/staff\/([^/]+)\/branches$/, { type: "team", action: "edit", target: "team", detail: () => "Changed their branches" }),
  R(["DELETE"], /^\/staff\/invites\/([^/]+)$/, { type: "team", action: "delete", target: "invite", detail: () => "Cancelled the invite" }),
  R(["DELETE"], /^\/staff\/([^/]+)$/, { type: "team", action: "delete", target: "team", detail: () => "Removed from the team" }),
  // Attendance › Staff & Trainers: the gym admin checks a Staff login or Trainer in or out by hand
  R(["POST"], /^\/team-attendance\/([^/]+)\/check-in$/, { type: "attendance", action: "create", target: "team", detail: () => "Checked in for work by hand" }),
  R(["POST"], /^\/team-attendance\/([^/]+)\/check-out$/, { type: "attendance", action: "edit", target: "team", detail: () => "Checked out from work by hand" }),
  // Members
  R(["POST"], /^\/members$/, { type: "member", action: "create", label: ({ body, answer }) => labelOf("member", { full_name: answer?.member?.name ?? body?.name, member_code: answer?.member?.code }), detail: ({ body }) => { const paid = paidLine(body?.paid, body?.method); return paid ? `New member · paid ${paid}` : "New member"; } }),
  R(["PATCH"], /^\/members\/([^/]+)$/, { type: "member", action: "edit", target: "member", detail: ({ before, after }) => changes("member", before, after) }),
  R(["POST"], /^\/members\/([^/]+)\/trainer$/, { type: "member", action: "edit", target: "member", detail: () => "Changed the PT trainer" }),
  R(["PUT"], /^\/members\/([^/]+)\/photo$/, { type: "member", action: "edit", target: "member", detail: () => "Added a new photo" }),
  R(["DELETE"], /^\/members\/([^/]+)\/photo$/, { type: "member", action: "delete", target: "member", detail: () => "Removed the photo" }),
  R(["POST"], /^\/members\/([^/]+)\/renew$/, { type: "payment", action: "create", target: "member", detail: ({ body, after }) => [`Renewed membership${after?.plan_name ? ` · ${after.plan_name}` : ""}`, after?.expires_on ? `now ends ${day(comparable(after.expires_on))}` : null, MODE[body?.method] ?? null].filter(Boolean).join(" · ") }),
  R(["POST"], /^\/members\/([^/]+)\/due$/, { type: "payment", action: "create", target: "member", detail: ({ body }) => `Collected due · ${paidLine(body?.amount, body?.method)}` }),
  R(["POST"], /^\/members\/([^/]+)\/pt$/, { type: "payment", action: "create", target: "member", detail: ({ body }) => [`PT${body?.package ? ` · ${String(body.package).slice(0, 40)}` : ""}`, paidLine(body?.amount, body?.method)].filter(Boolean).join(" · ") }),
  R(["POST"], /^\/members\/([^/]+)\/sales$/, { type: "payment", action: "create", target: "member", detail: ({ body, extra }) => [`Sold ${extra?.item ?? "a product"}${body?.quantity > 1 ? ` × ${body.quantity}` : ""}`, paidLine(body?.paid, body?.method)].filter(Boolean).join(" · ") }),
  R(["POST"], /^\/members\/([^/]+)\/services$/, { type: "payment", action: "create", target: "member", detail: ({ body, extra }) => [`Added service ${extra?.item ?? ""}`.trim(), paidLine(body?.paid, body?.method)].filter(Boolean).join(" · ") }),
  R(["POST"], /^\/members\/([^/]+)\/pause$/, { type: "pause", action: "create", target: "member", detail: ({ body }) => `Paused ${day(body?.from)} to ${day(body?.until)}` }),
  R(["POST"], /^\/members\/([^/]+)\/check-in$/, { type: "attendance", action: "create", target: "member", detail: () => "Checked in by hand" }),
  R(["POST"], /^\/members\/([^/]+)\/check-out$/, { type: "attendance", action: "edit", target: "member", detail: () => "Checked out by hand" }),
  R(["POST"], /^\/members\/([^/]+)\/sms$/, { type: "sms", action: "create", target: "member", detail: () => "Sent an SMS (1 credit)" }),
  R(["POST"], /^\/pauses\/([^/]+)\/approve$/, { type: "pause", action: "edit", target: "pause", detail: () => "Approved the pause request" }),
  R(["POST"], /^\/pauses\/([^/]+)\/reject$/, { type: "pause", action: "edit", target: "pause", detail: () => "Rejected the pause request" }),
  // Counter sales and payment bills
  R(["POST"], /^\/services$/, { type: "payment", action: "create", label: ({ body }) => String(body?.item ?? "A service").slice(0, 80), detail: ({ body }) => `Service at the counter · ${paidLine(body?.amount, body?.method)}` }),
  R(["POST"], /^\/sales$/, { type: "payment", action: "create", label: ({ body }) => String(body?.item ?? "A product").slice(0, 80), detail: ({ body }) => `Product at the counter · ${paidLine(body?.amount, body?.method)}` }),
  R(["PUT"], /^\/payments\/([^/]+)\/receipt$/, { type: "payment", action: "edit", target: "payment", detail: () => "Attached the payment bill" }),
  R(["DELETE"], /^\/payments\/([^/]+)\/receipt$/, { type: "payment", action: "delete", target: "payment", detail: () => "Removed the payment bill" }),
  // Enquiries
  R(["POST"], /^\/enquiries$/, { type: "enquiry", action: "create", label: ({ body, answer }) => answer?.enquiry?.name ?? body?.name ?? null, detail: () => "New enquiry" }),
  R(["PATCH"], /^\/enquiries\/([^/]+)$/, { type: "enquiry", action: "edit", target: "enquiry", detail: ({ before, after }) => changes("enquiry", before, after) }),
  R(["POST"], /^\/enquiries\/([^/]+)\/contacts$/, { type: "enquiry", action: "create", target: "enquiry", detail: ({ body }) => `${body?.kind === "visit" ? "Logged a visit" : `Logged a ${body?.kind === "whatsapp" ? "WhatsApp message" : "call"}: ${body?.outcome === "no_answer" ? "no answer" : "reached"}`}${typeof body?.followUpOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.followUpOn) ? `, next follow-up ${body.followUpOn}` : ""}` }),
  // Plans / Catalogue
  R(["POST"], /^\/catalog$/, { type: "catalog", action: "create", label: ({ body }) => labelOf("catalog", { kind: body?.kind, name: body?.name }), detail: ({ body }) => (body?.price !== undefined ? `Price ${rupees(body.price)}` : null) }),
  R(["PATCH"], /^\/catalog\/([^/]+)$/, { type: "catalog", action: "edit", target: "catalog", detail: ({ before, after, body }) => [changes("catalog", before, after), catalogExtras(body)].filter(Boolean).join(" · ") || null }),
  R(["PUT"], /^\/catalog\/order$/, { type: "catalog", action: "edit", label: ({ body }) => `${CATALOG_KIND_LABEL[body?.kind] ?? "Catalogue"} order`, detail: () => "Changed the order members see" }),
  R(["DELETE"], /^\/catalog\/([^/]+)$/, { type: "catalog", action: "delete", target: "catalog", detail: ({ before }) => (before ? `Was ${rupees(before.price)}` : null) }),
  R(["PUT"], /^\/catalog\/([^/]+)\/image$/, { type: "catalog", action: "edit", target: "catalog", detail: () => "Added a new image" }),
  R(["DELETE"], /^\/catalog\/([^/]+)\/image$/, { type: "catalog", action: "delete", target: "catalog", detail: () => "Removed the image" }),
  // Invoice details and the logo, Reminder Templates (the gym admin's)
  R(["PATCH"], /^\/invoice-details$/, { type: "settings", action: "edit", label: () => "Invoice details", detail: () => "Changed the address, mobile or GSTIN" }),
  R(["PUT"], /^\/logo$/, { type: "settings", action: "edit", label: () => "Gym logo", detail: () => "Added a new logo" }),
  R(["DELETE"], /^\/logo$/, { type: "settings", action: "delete", label: () => "Gym logo", detail: () => "Removed the logo" }),
  // Gym Profile (Gym Hub; Gym Profile Management): the draft, the photos and Publish
  R(["PATCH"], /^\/profile$/, { type: "settings", action: "edit", label: () => "Gym Profile", detail: ({ body }) => `Changed the draft's ${Object.keys(PROFILE_FIELD).filter((k) => body?.[k] !== undefined).map((k) => PROFILE_FIELD[k]).join(", ") || "profile"}` }),
  R(["POST"], /^\/profile\/photos$/, { type: "settings", action: "create", label: () => "Gym Profile", detail: () => "Added a photo" }),
  R(["PUT"], /^\/profile\/photos\/order$/, { type: "settings", action: "edit", label: () => "Gym Profile", detail: () => "Changed the order of the photos" }),
  R(["PUT"], /^\/profile\/trainers\/([^/]+)$/, { type: "settings", action: "edit", label: () => "Trainer profile", detail: ({ body }) => (body?.active === true ? "Showed a trainer to members" : body?.active === false ? "Hid a trainer from members" : "Edited a trainer's profile") }),
  R(["PUT"], /^\/profile\/trainers\/([^/]+)\/photo$/, { type: "settings", action: "edit", label: () => "Trainer profile", detail: () => "Changed a trainer's photo" }),
  R(["DELETE"], /^\/profile\/trainers\/([^/]+)\/photo$/, { type: "settings", action: "delete", label: () => "Trainer profile", detail: () => "Removed a trainer's photo" }),
  R(["POST"], /^\/profile\/publish$/, { type: "settings", action: "edit", label: () => "Gym Profile", detail: () => "Published the profile to members" }),
  R(["DELETE"], /^\/profile\/photos\/([^/]+)$/, { type: "settings", action: "delete", label: () => "Gym Profile", detail: () => "Removed a photo" }),
  R(["POST"], /^\/templates\/added$/, { type: "template", action: "create", label: ({ body }) => String(body?.name ?? "A template").slice(0, 40), detail: () => "New template" }),
  R(["PUT"], /^\/templates\/added\/([^/]+)$/, { type: "template", action: "edit", target: "template", detail: () => "Changed the template" }),
  R(["DELETE"], /^\/templates\/added\/([^/]+)$/, { type: "template", action: "delete", target: "template", detail: () => "Deleted the template" }),
  R(["PUT"], /^\/templates\/([^/]+)$/, { type: "template", action: "edit", label: ({ id }) => TEMPLATE_KIND[id] ?? "A reminder", detail: () => "Changed the wording" }),
  R(["DELETE"], /^\/templates\/([^/]+)$/, { type: "template", action: "edit", label: ({ id }) => TEMPLATE_KIND[id] ?? "A reminder", detail: () => "Reset to the default wording" }),
  // SMS and attendance settings
  R(["PATCH"], /^\/sms\/settings$/, { type: "sms", action: "edit", label: () => "Auto reminders", detail: () => "Changed the auto reminder switches" }),
  R(["POST"], /^\/sms\/send$/, { type: "sms", action: "create", label: ({ body }) => `SMS to ${SMS_GROUP[body?.group] ?? "a group"}`, detail: ({ answer }) => (answer && Number.isInteger(answer.sent) ? `${answer.sent} sent` : null) }),
  R(["PUT"], /^\/attendance\/location$/, { type: "attendance", action: "edit", label: () => "Location & Attendance", detail: () => "Changed the gym location or check-in radius" }),
  R(["PUT"], /^\/attendance\/crowd-settings$/, { type: "attendance", action: "edit", label: () => "Crowd settings", detail: ({ body }) => [body?.capacity !== undefined ? `capacity ${body.capacity ?? "cleared"}` : null, body?.avgStayMin !== undefined ? `usual workout ${body.avgStayMin ?? "from history"}` : null, body?.thresholds !== undefined ? "crowd levels" : null].filter(Boolean).join(", ") || null }),
  R(["POST"], /^\/attendance\/qr$/, { type: "attendance", action: "edit", label: () => "Attendance QR code", detail: () => "Made a new QR code (old prints stop working)" }),
  // Expenses
  R(["POST"], /^\/expenses$/, { type: "expense", action: "create", label: ({ body, answer }) => labelOf("expense", { title: answer?.expense?.title ?? body?.title, category: body?.category }), detail: ({ body }) => paidLine(body?.amount, body?.method) }),
  R(["PUT"], /^\/expenses\/([^/]+)$/, { type: "expense", action: "edit", target: "expense", detail: ({ before, after }) => changes("expense", before, after) }),
  R(["DELETE"], /^\/expenses\/([^/]+)$/, { type: "expense", action: "delete", target: "expense", detail: ({ before }) => (before ? `Was ${paidLine(before.amount, before.method)}` : null) }),
  R(["PUT"], /^\/expenses\/([^/]+)\/bill$/, { type: "expense", action: "edit", target: "expense", detail: () => "Attached the bill" }),
  R(["DELETE"], /^\/expenses\/([^/]+)\/bill$/, { type: "expense", action: "delete", target: "expense", detail: () => "Removed the bill" }),
];

// The entry a write is recorded as: { entry, id } (entry null: nothing to record), or undefined
// when the request isn't listed (a read, or a write nobody mapped: the test catches those)
function routeOf(method, path) {
  const verb = String(method).toUpperCase();
  const normalised = String(path).toLowerCase().replace(/\/+$/, "") || "/";
  for (const [methods, pattern, entry] of ROUTES) {
    if (!methods.includes(verb)) continue;
    const found = pattern.exec(normalised);
    if (!found) continue;
    let id = null;
    try {
      id = found[1] ? decodeURIComponent(found[1]) : null;
    } catch {
      id = null; // a broken %-escape: the route answers 400 itself, and nothing is recorded
    }
    return { entry, id };
  }
  return undefined;
}

// The row as saved: the label and the line cut to their columns
function rowFor(entry, ctx) {
  const label = (entry.label ? entry.label(ctx) : labelOf(entry.target, ctx.before ?? ctx.after)) || "Something";
  const detail = entry.detail ? entry.detail(ctx) : null;
  return { action: entry.action, type: entry.type, label: String(label).slice(0, 120), detail: detail ? String(detail).slice(0, 200) : null };
}

// GET /api/gym/activity?day=YYYY-MM-DD&action=all|create|edit|delete&person=<user id>|all&page=N
// day: today by default, at most a year back, never in the future
function activityQuery(query, today) {
  const q = query ?? {};
  const known = ["day", "action", "person", "page"];
  if (Object.keys(q).some((k) => !known.includes(k))) throw new ValidationError("That request has fields we don't use.");
  const dayValue = q.day === undefined || q.day === "" ? today : q.day;
  if (typeof dayValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayValue) || Number.isNaN(Date.parse(`${dayValue}T00:00:00Z`))) throw new ValidationError("Pick a day.");
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  if (dayValue > today || dayValue < oldest) throw new ValidationError("Activity is kept for a year. Pick a day in the last year.");
  const action = q.action === undefined || q.action === "" ? "all" : q.action;
  if (action !== "all" && !ACTIONS.includes(action)) throw new ValidationError("Pick added, edited, deleted or all.");
  const person = q.person === undefined || q.person === "" ? "all" : q.person;
  if (typeof person !== "string" || (person !== "all" && !/^[A-Za-z0-9_]{1,64}$/.test(person))) throw new ValidationError("Pick someone on your team.");
  const page = q.page === undefined || q.page === "" ? 1 : Number(q.page);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new ValidationError("That page doesn't exist.");
  return { day: dayValue, action, person, page };
}

module.exports = { ACTIONS, TYPES, KEEP_DAYS, PAGE_SIZE, FIELDS, ROUTES, changes, labelOf, routeOf, rowFor, activityQuery };
