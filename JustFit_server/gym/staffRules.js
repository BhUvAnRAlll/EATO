// Staff / Admin Login's rules (pure, unit-tested): what a gym admin may send, and who may join or
// leave a branch's team. The gym admin (kind 'owner', linked by the justFit Super Admin) adds people
// by their sign-in number as Staff (the gym portal, role gym_admin) or Trainer (the member app with
// their PT clients, role trainer). An account works at branches of one gym only, and is either
// portal staff or a trainer, never both.
const { ValidationError } = require("../profile");
const { ConflictError } = require("../errors");
const { normalizePhone } = require("../auth/phone");

const KINDS = ["staff", "trainer"];
// Role & Permission: the portal's areas a Staff login can be given (in the order the sheet shows)
// home and templates (2026-11-08) have no routes of their own: home decides what the dashboard
// carries (dashboardFor), templates which Staff see the Reminder Templates screen
const AREAS = ["home", "members", "payments", "enquiries", "catalog", "profile", "attendance", "sms", "templates", "predictions", "expenses"];
const AREA_LABEL = {
  home: "Home",
  members: "Members",
  payments: "Payments",
  enquiries: "Enquiries",
  catalog: "Plans / Catalogue",
  profile: "Gym Profile",
  attendance: "Attendance",
  sms: "SMS",
  templates: "Reminder Templates",
  predictions: "Predictions",
  expenses: "Expenses",
};
// Which area a gym route belongs to, by its path under /api/gym (the first match wins). Routes
// with no area (the dashboard, branches, the team) are open to every portal login; the team is
// the gym admin's alone anyway (requireGymOwner).
const AREA_OF_PATH = [
  [/^\/members\/[^/]+\/sms$/, "sms"],
  [/^\/members\/[^/]+\/(due|pt|sales|services)$/, "payments"],
  [/^\/members\/[^/]+\/check-(in|out)$/, "attendance"],
  // A payment's bill is attached from Add Member and seen on the member's page, so it goes with members
  [/^\/payments\/[^/]+\/receipt$/, "members"],
  // An invoice is sent from the member's ⋯ sheet and their page, so it goes with members too
  [/^\/payments\/[^/]+\/invoice$/, "members"],
  [/^\/(members|trainers|pauses)(\/|$)/, "members"],
  [/^\/pause-policy$/, "members"],
  [/^\/(payments|services|sales|wallet)(\/|$)/, "payments"],
  [/^\/enquiries(\/|$)/, "enquiries"],
  [/^\/catalog(\/|$)/, "catalog"],
  [/^\/profile(\/|$)/, "profile"],
  [/^\/reviews(\/|$)/, "profile"],
  [/^\/sms(\/|$)/, "sms"],
  [/^\/attendance(\/|$)/, "attendance"],
  [/^\/predictions(\/|$)/, "predictions"],
  [/^\/expenses(\/|$)/, "expenses"],
];
// Role & Permission's options (2026-11-08, the user's reference screen): each area is a tile with
// options the gym admin ticks one by one. `needs`: the option it can't work without (the list or
// screen it opens from), ticked with it and unticked when that one is. A new option starts
// unticked for Staff whose list was already saved; NULL (never edited) is every option.
const OPTIONS = [
  { id: "home.revenue", area: "home", label: "Today's collection (revenue card)" },
  { id: "home.today", area: "home", label: "Today's counts" },
  { id: "members.view", area: "members", label: "Member list and pages" },
  { id: "members.add", area: "members", label: "Add Member", needs: "members.view" },
  { id: "members.edit", area: "members", label: "Edit profile, photo and trainer", needs: "members.view" },
  { id: "members.renew", area: "members", label: "Renew membership", needs: "members.view" },
  { id: "members.pause", area: "members", label: "Pause membership and pause requests", needs: "members.view" },
  { id: "members.standing", area: "members", label: "Suspend, cancel or reactivate memberships", needs: "members.view" },
  { id: "payments.collect", area: "payments", label: "Collect payment due" },
  { id: "payments.pt", area: "payments", label: "Personal training (PT)" },
  { id: "payments.sales", area: "payments", label: "Product and service sales" },
  { id: "payments.transactions", area: "payments", label: "Transactions" },
  { id: "payments.wallet", area: "payments", label: "Wallet" },
  { id: "enquiries.view", area: "enquiries", label: "Enquiry list" },
  { id: "enquiries.edit", area: "enquiries", label: "Add and edit enquiries", needs: "enquiries.view" },
  { id: "enquiries.contacts", area: "enquiries", label: "Log calls and visits", needs: "enquiries.view" },
  { id: "catalog.view", area: "catalog", label: "See plans and prices" },
  { id: "catalog.edit", area: "catalog", label: "Add, edit and delete plans", needs: "catalog.view" },
  // Gym Profile (2026-11-09): what members see about the branch; publishing makes the draft live
  { id: "profile.view", area: "profile", label: "See the gym profile and its preview" },
  { id: "profile.edit", area: "profile", label: "Edit details, photos, facilities and hours", needs: "profile.view" },
  { id: "profile.publish", area: "profile", label: "Publish the profile to members", needs: "profile.view" },
  { id: "profile.trainers", area: "profile", label: "Trainer profiles", needs: "profile.view" },
  { id: "profile.reviews", area: "profile", label: "Reply to and hide reviews", needs: "profile.view" },
  { id: "attendance.view", area: "attendance", label: "Attendance and history" },
  { id: "attendance.checkin", area: "attendance", label: "Check members in and out" },
  { id: "attendance.export", area: "attendance", label: "Export history (CSV)", needs: "attendance.view" },
  { id: "attendance.settings", area: "attendance", label: "Location and QR code", needs: "attendance.view" },
  { id: "attendance.correct", area: "attendance", label: "Correct visits and add missed ones", needs: "attendance.view" },
  { id: "sms.view", area: "sms", label: "Credits and message logs" },
  { id: "sms.send", area: "sms", label: "Send SMS", needs: "sms.view" },
  { id: "sms.auto", area: "sms", label: "Auto reminder settings", needs: "sms.view" },
  { id: "sms.notifications", area: "sms", label: "Member notifications (which notices members get)" },
  { id: "templates.view", area: "templates", label: "See the Reminder Templates screen" },
  { id: "predictions.renewals", area: "predictions", label: "Likely to leave" },
  { id: "predictions.payments", area: "predictions", label: "Payment on time" },
  { id: "predictions.busy", area: "predictions", label: "Tomorrow's busy hours" },
  { id: "predictions.revenue", area: "predictions", label: "Month-end revenue" },
  { id: "expenses.view", area: "expenses", label: "Expense list and bills" },
  { id: "expenses.edit", area: "expenses", label: "Add and edit expenses", needs: "expenses.view" },
];
const OPTION_IDS = OPTIONS.map((o) => o.id);
// The options whose forms pick from the catalogue (they read GET /catalog, never change it)
const CATALOG_PICKERS = ["members.add", "members.renew", "payments.pt", "payments.sales"];
// The only route an option of another area may use: [method, path, options]
const CROSS_AREA = [["GET", "/catalog", CATALOG_PICKERS]];
const OPTION = Object.fromEntries(OPTIONS.map((o) => [o.id, o]));
// Which option(s) a request needs: [methods, path, options] (any one of them will do; the first
// match wins). Read on the same lower-cased path as areaOfPath; a request in an area that matches
// nothing here is refused (requireArea), so a new route can't slip through unmapped.
const OPTION_OF_ROUTE = [
  [["GET"], /^\/members\/next-code$/, ["members.add"]],
  [["POST"], /^\/members$/, ["members.add"]],
  // Add Member uploads the photo and the payment bill right after the member is saved
  [["PUT", "DELETE"], /^\/members\/[^/]+\/photo$/, ["members.add", "members.edit"]],
  [["PUT", "DELETE"], /^\/payments\/[^/]+\/receipt$/, ["members.add"]],
  [["PATCH"], /^\/members\/[^/]+$/, ["members.edit"]],
  [["POST"], /^\/members\/[^/]+\/trainer$/, ["members.edit"]],
  [["POST"], /^\/members\/[^/]+\/renew$/, ["members.renew"]],
  [["POST"], /^\/members\/[^/]+\/pause$/, ["members.pause"]],
  [["POST"], /^\/members\/[^/]+\/standing$/, ["members.standing"]],
  [["GET", "PUT"], /^\/pause-policy$/, ["members.pause"]],
  [["GET", "POST"], /^\/pauses(\/|$)/, ["members.pause"]],
  [["POST"], /^\/members\/[^/]+\/due$/, ["payments.collect"]],
  [["POST"], /^\/members\/[^/]+\/pt$/, ["payments.pt"]],
  [["POST"], /^\/(members\/[^/]+\/)?(sales|services)$/, ["payments.sales"]],
  [["GET"], /^\/payments$/, ["payments.transactions"]],
  [["GET"], /^\/wallet$/, ["payments.wallet"]],
  [["POST"], /^\/members\/[^/]+\/check-(in|out)$/, ["attendance.checkin"]],
  [["POST"], /^\/members\/[^/]+\/sms$/, ["sms.send"]],
  [["GET"], /^\/(members(\/[^/]+(\/(photo|invoice))?)?|trainers|payments\/[^/]+\/(receipt|invoice))$/, ["members.view"]],
  [["GET"], /^\/enquiries$/, ["enquiries.view"]],
  [["POST"], /^\/enquiries$/, ["enquiries.edit"]],
  [["PATCH"], /^\/enquiries\/[^/]+$/, ["enquiries.edit"]],
  [["POST"], /^\/enquiries\/[^/]+\/contacts$/, ["enquiries.contacts"]],
  // The price list is read by the forms that pick a plan or an item (Add Member, Renew, PT,
  // Add Service / Sell Product), so those options may read it too: the one shared read (CROSS_AREA)
  [["GET"], /^\/catalog$/, ["catalog.view", ...CATALOG_PICKERS]],
  [["GET"], /^\/catalog\/[^/]+\/image$/, ["catalog.view"]],
  [["POST", "PATCH", "PUT", "DELETE"], /^\/catalog(\/|$)/, ["catalog.edit"]],
  [["GET"], /^\/profile(\/preview|\/photos\/[^/]+|\/trainers(\/[^/]+\/photo)?)?$/, ["profile.view"]],
  [["PUT", "DELETE"], /^\/profile\/trainers\/[^/]+(\/photo)?$/, ["profile.trainers"]],
  [["PATCH"], /^\/profile$/, ["profile.edit"]],
  [["POST"], /^\/profile\/photos$/, ["profile.edit"]],
  [["PUT"], /^\/profile\/photos\/order$/, ["profile.edit"]],
  [["PUT"], /^\/profile\/photos\/[^/]+\/facility$/, ["profile.edit"]],
  [["DELETE"], /^\/profile\/photos\/[^/]+$/, ["profile.edit"]],
  [["POST"], /^\/profile\/publish$/, ["profile.publish"]],
  [["GET"], /^\/reviews$/, ["profile.view"]],
  [["PUT", "DELETE"], /^\/reviews\/[^/]+\/reply$/, ["profile.reviews"]],
  [["POST"], /^\/reviews\/[^/]+\/(hide|show)$/, ["profile.reviews"]],
  [["GET"], /^\/attendance(\/visits)?$/, ["attendance.view"]],
  [["GET"], /^\/attendance\/export$/, ["attendance.export"]],
  [["GET"], /^\/attendance\/settings$/, ["attendance.settings"]],
  [["GET"], /^\/attendance\/crowd$/, ["attendance.view"]],
  [["POST"], /^\/attendance\/visits$/, ["attendance.correct"]],
  [["PATCH"], /^\/attendance\/visits\/[^/]+$/, ["attendance.correct"]],
  [["GET"], /^\/attendance\/corrections$/, ["attendance.view"]],
  [["PUT"], /^\/attendance\/crowd-settings$/, ["attendance.settings"]],
  [["PUT", "POST"], /^\/attendance\/(location|qr)$/, ["attendance.settings"]],
  [["GET"], /^\/sms(\/logs)?$/, ["sms.view"]],
  [["POST"], /^\/sms\/send$/, ["sms.send"]],
  [["PATCH"], /^\/sms\/settings$/, ["sms.auto"]],
  [["GET", "PUT"], /^\/sms\/member-notifications$/, ["sms.notifications"]],
  [["GET"], /^\/predictions\/renewals$/, ["predictions.renewals"]],
  [["GET"], /^\/predictions\/payments$/, ["predictions.payments"]],
  [["GET"], /^\/predictions\/busy-hours$/, ["predictions.busy"]],
  [["GET"], /^\/predictions\/revenue$/, ["predictions.revenue"]],
  [["GET"], /^\/expenses(\/[^/]+\/bill)?$/, ["expenses.view"]],
  [["POST"], /^\/expenses$/, ["expenses.edit"]],
  [["PUT", "DELETE"], /^\/expenses\/[^/]+(\/bill)?$/, ["expenses.edit"]],
];
// The role each kind of team member has
const ROLE_FOR = { owner: "gym_admin", staff: "gym_admin", trainer: "trainer" };
const KIND_LABEL = { owner: "Gym admin", staff: "Staff", trainer: "Trainer" };

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// POST /api/gym/staff: { phone, kind, branchId?, preset? }. branchId (2026-11-07): the branch to add them
// to; left out, the open branch. staff.add checks it's a branch of this gym the caller manages.
// preset (2026-11-10, gym roles): a Staff login's role (gym/rolePresets.js), checked in staff.add.
function addBody(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((key) => !["phone", "kind", "branchId", "preset"].includes(key))) throw new ValidationError("That request has fields we don't use.");
  if (!KINDS.includes(body.kind)) throw new ValidationError("Choose Staff or Trainer.");
  const out = { phone: normalizePhone(body.phone), kind: body.kind };
  if (body.preset !== undefined && body.preset !== null) {
    if (body.kind !== "staff" || typeof body.preset !== "string" || body.preset.length > 20) throw new ValidationError("Pick a role from the list.");
    out.preset = body.preset;
  }
  if (body.branchId !== undefined && body.branchId !== null) {
    if (!Number.isInteger(body.branchId) || body.branchId < 1 || body.branchId > 2147483647) throw new ValidationError("Pick one of your branches.");
    out.branchId = body.branchId;
  }
  return out;
}

// PUT /api/gym/staff/:userId/branches: { branchIds: [1, 2] } (2026-11-09): the branches of this gym
// the person works at, out of those the caller manages. At least one: taking someone off every
// branch is Remove. Answers the ids once each, in the order sent.
function branchesBody(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((key) => key !== "branchIds")) throw new ValidationError("That request has fields we don't use.");
  const list = body.branchIds;
  if (!Array.isArray(list) || list.length > 100) throw new ValidationError("Pick their branches.");
  if (list.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)) throw new ValidationError("Pick one of your branches.");
  const branchIds = [...new Set(list)];
  if (branchIds.length === 0) throw new ValidationError("Pick at least one branch. To take them off the team, use Remove.");
  return { branchIds };
}

// PUT /api/gym/staff/:userId/permissions: { options: ["members.view", ...] } (an empty list is
// allowed: Home only). The older { areas: [...] } still works and gives every option of those
// areas. An option brings the one it needs. Answers the options in OPTIONS order, each once.
function permissionsBody(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  const keys = Object.keys(body);
  if (keys.length !== 1 || !["options", "areas"].includes(keys[0])) throw new ValidationError("That request has fields we don't use.");
  const list = body[keys[0]];
  const known = keys[0] === "options" ? OPTION_IDS : AREAS;
  if (!Array.isArray(list) || list.length > known.length) throw new ValidationError("Choose what they can use.");
  if (list.some((entry) => !known.includes(entry))) throw new ValidationError(keys[0] === "options" ? "That isn't one of the portal's options." : "That isn't one of the portal's areas.");
  return { options: expandOptions(list, true) };
}

// The options a saved list stands for, in OPTIONS order: an area's id (saved before 2026-11-08)
// stands for all its options. withNeeds: add the options the ticked ones need (a save); without,
// drop an option whose need is missing (a read, so a list edited by hand can't widen access).
function expandOptions(list, withNeeds) {
  const picked = new Set();
  for (const entry of list) {
    if (AREAS.includes(entry)) OPTIONS.filter((o) => o.area === entry).forEach((o) => picked.add(o.id));
    else if (OPTION[entry]) picked.add(entry);
  }
  for (const id of [...picked]) {
    const needs = OPTION[id].needs;
    if (needs && !picked.has(needs)) {
      if (withNeeds) picked.add(needs);
      else picked.delete(id);
    }
  }
  return OPTION_IDS.filter((id) => picked.has(id));
}

// The options a team row allows: the gym admin everything, Staff what was saved for them (NULL =
// everything, every Staff login before the gym admin edits them), a trainer nothing (no portal)
function optionsOf(row) {
  if (row.kind === "owner") return [...OPTION_IDS];
  if (row.kind !== "staff") return [];
  let saved = row.permissions;
  if (typeof saved === "string") {
    try {
      saved = JSON.parse(saved);
    } catch {
      return []; // a corrupt value (only ever written with JSON.stringify) locks the login down, never 500s every request
    }
  }
  if (!Array.isArray(saved)) return [...OPTION_IDS];
  return expandOptions(saved, false);
}

// The areas a team row allows: those with at least one option ticked
function areasOf(row) {
  const options = optionsOf(row);
  return AREAS.filter((a) => options.some((id) => OPTION[id].area === a));
}

// The tree Role & Permission draws: each area with its options, in order
const permissionTree = () => AREAS.map((area) => ({
  id: area,
  label: AREA_LABEL[area],
  options: OPTIONS.filter((o) => o.area === area).map((o) => ({ id: o.id, label: o.label, needs: o.needs ?? null })),
}));

// Home's dashboard as this login may see it: the revenue card and today's counts follow the Home
// options, the recent payments Transactions, and each Needs attention count the screen it opens
// (null when not included, so nothing the login can't open leaves the server)
function dashboardFor(dashboard, options) {
  const has = (id) => options.includes(id);
  const a = dashboard.alerts;
  return {
    ...dashboard,
    revenue: has("home.revenue") ? dashboard.revenue : null,
    stats: has("home.today") ? dashboard.stats : null,
    recent: has("payments.transactions") ? dashboard.recent : [],
    alerts: {
      dueMembers: has("members.view") || has("predictions.payments") ? a.dueMembers : null,
      expiringToday: has("members.view") ? a.expiringToday : null,
      attendance: has("attendance.view") ? a.attendance : null,
      expiringSoon: has("members.view") ? a.expiringSoon : null,
      birthdays: has("members.view") ? a.birthdays : null,
      pauseRequests: has("members.pause") ? a.pauseRequests : null,
      renewalRisk: has("predictions.renewals") ? a.renewalRisk ?? null : null,
    },
  };
}

// The audit log's line: "Members (2 of 5), Enquiries (all)" or "Home only"
function optionsSummary(options) {
  const parts = AREAS.map((area) => {
    const all = OPTIONS.filter((o) => o.area === area).length;
    const on = options.filter((id) => OPTION[id].area === area).length;
    if (on === 0) return null;
    return `${AREA_LABEL[area]} (${on === all ? "all" : `${on} of ${all}`})`;
  }).filter(Boolean);
  return parts.length ? parts.join(", ") : "Home only";
}

// The area a request under /api/gym needs, or null when every portal login may make it. The path
// is read lower-cased and without a trailing slash, so a spelling the router might still accept
// can never read as "no area" (the gym router is strict too; this is the second lock)
function areaOfPath(path) {
  const normalised = String(path).toLowerCase().replace(/\/+$/, "") || "/";
  const found = AREA_OF_PATH.find(([pattern]) => pattern.test(normalised));
  return found ? found[1] : null;
}

// The options a request under /api/gym may be made with (any one will do), or null when nothing
// matches. HEAD is read as GET (Express answers it with the GET route).
function optionsOfRequest(method, path) {
  const verb = String(method).toUpperCase() === "HEAD" ? "GET" : String(method).toUpperCase();
  const normalised = String(path).toLowerCase().replace(/\/+$/, "") || "/";
  const found = OPTION_OF_ROUTE.find(([methods, pattern]) => methods.includes(verb) && pattern.test(normalised));
  return found ? found[2] : null;
}

// The words for a refusal: "Members › Add Member"
const optionLabel = (id) => `${AREA_LABEL[OPTION[id].area]} › ${OPTION[id].label}`;

// Why the caller can't change this team member's permissions, or null. target: the gym_staff row
function permissionsProblem(callerId, target) {
  if (target.userId === callerId) return "You can't change your own access.";
  if (target.kind !== "staff") return "Only Staff logins have permissions.";
  return null;
}

// Why the caller can't change this team member's branches, or null. target: the gym_staff row
function branchesProblem(callerId, target) {
  if (target.userId === callerId) return "You can't change your own branches.";
  if (target.kind === "owner") return "Only the justFit team can change a gym admin's branches.";
  return null;
}

// Which of the caller's branches to join and leave. current: the branch ids (of those the caller
// manages) the person works at now; wanted: the ids picked. Both lists are of managed branches.
function branchChanges(current, wanted) {
  return { join: wanted.filter((id) => !current.includes(id)), leave: current.filter((id) => !wanted.includes(id)) };
}

// An account id from the path (user_ + base62; older Clerk ids are letters, numbers and _)
function userIdParam(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(value)) throw new ValidationError("That isn't one of your team.");
  return value;
}

// Why an account can't join this branch as `kind`, or null when it can.
// account: { role }; links: the account's branches [{ gymId, brandId, kind }]; gym: { id, brandId }
function joinProblem(account, links, gym, kind) {
  if (account.role === "admin") return "That account can't be added as gym staff.";
  if (links.some((l) => l.brandId !== gym.brandId)) return "That number works at another gym.";
  if (links.some((l) => l.gymId === gym.id)) return "They're already on your team.";
  const wanted = ROLE_FOR[kind];
  if (account.role !== "user" && account.role !== wanted) {
    return account.role === "trainer" ? "They're a Trainer at your gym. Add them as a Trainer." : "They're Staff at your gym. Add them as Staff.";
  }
  return null;
}

// Throws the 409 joinProblem names
function checkJoin(account, links, gym, kind) {
  const problem = joinProblem(account, links, gym, kind);
  if (problem) throw new ConflictError(problem);
}

// Why a number can't be invited (it has no account yet), or null.
// invites: the number's open invites [{ gymId, brandId, kind }]
function inviteProblem(invites, gym, kind) {
  if (invites.some((i) => i.gymId === gym.id)) return "They've already been invited.";
  if (invites.some((i) => i.brandId !== gym.brandId)) return "That number has been invited by another gym.";
  if (invites.some((i) => i.kind !== kind)) return `They've been invited to another branch as ${KIND_LABEL[invites[0].kind]}. Add them as ${KIND_LABEL[invites[0].kind]} here too.`;
  return null;
}

// Why the caller can't remove this team member, or null. target: the gym_staff row
function removeProblem(callerId, target) {
  if (target.userId === callerId) return "You can't remove yourself.";
  if (target.kind === "owner") return "Only the justFit team can remove a gym admin.";
  return null;
}

// The role an account keeps after leaving a branch: unchanged while it still works at another;
// back to a member once it has no branch left (an admin is never touched)
function roleAfterLeaving(role, branchesLeft) {
  if (branchesLeft > 0 || role === "admin") return role;
  return "user";
}

// "+91 ••••• ••210": lists show only the last three digits
const maskPhone = (digits) => (typeof digits === "string" && /^[0-9]{10}$/.test(digits) ? `+91 ••••• ••${digits.slice(7)}` : null);

module.exports = { KINDS, AREAS, CROSS_AREA, AREA_LABEL, OPTIONS, OPTION_IDS, ROLE_FOR, KIND_LABEL, addBody, branchesBody, permissionsBody, expandOptions, optionsOf, areasOf, permissionTree, dashboardFor, optionsSummary, areaOfPath, optionsOfRequest, optionLabel, permissionsProblem, branchesProblem, branchChanges, userIdParam, joinProblem, checkJoin, inviteProblem, removeProblem, roleAfterLeaving, maskPhone };
