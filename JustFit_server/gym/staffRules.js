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
const AREAS = ["members", "payments", "enquiries", "catalog", "attendance", "sms", "predictions"];
const AREA_LABEL = {
  members: "Members",
  payments: "Payments",
  enquiries: "Enquiries",
  catalog: "Plans / Catalogue",
  attendance: "Attendance",
  sms: "SMS",
  predictions: "Predictions",
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
  [/^\/(payments|services|sales|wallet)(\/|$)/, "payments"],
  [/^\/enquiries(\/|$)/, "enquiries"],
  [/^\/catalog(\/|$)/, "catalog"],
  [/^\/sms(\/|$)/, "sms"],
  [/^\/attendance(\/|$)/, "attendance"],
  [/^\/predictions(\/|$)/, "predictions"],
];
// The role each kind of team member has
const ROLE_FOR = { owner: "gym_admin", staff: "gym_admin", trainer: "trainer" };
const KIND_LABEL = { owner: "Gym admin", staff: "Staff", trainer: "Trainer" };

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// POST /api/gym/staff: { phone, kind, branchId? }. branchId (2026-11-07): the branch to add them
// to; left out, the open branch. staff.add checks it's a branch of this gym the caller manages.
function addBody(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((key) => !["phone", "kind", "branchId"].includes(key))) throw new ValidationError("That request has fields we don't use.");
  if (!KINDS.includes(body.kind)) throw new ValidationError("Choose Staff or Trainer.");
  const out = { phone: normalizePhone(body.phone), kind: body.kind };
  if (body.branchId !== undefined && body.branchId !== null) {
    if (!Number.isInteger(body.branchId) || body.branchId < 1 || body.branchId > 2147483647) throw new ValidationError("Pick one of your branches.");
    out.branchId = body.branchId;
  }
  return out;
}

// PUT /api/gym/staff/:userId/permissions: { areas: ["members", ...] } (an empty list is allowed:
// Home only). Answers the areas in AREAS order, each once.
function permissionsBody(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((key) => key !== "areas")) throw new ValidationError("That request has fields we don't use.");
  if (!Array.isArray(body.areas) || body.areas.length > AREAS.length) throw new ValidationError("Choose which areas they can use.");
  if (body.areas.some((a) => !AREAS.includes(a))) throw new ValidationError("That isn't one of the portal's areas.");
  return { areas: AREAS.filter((a) => body.areas.includes(a)) };
}

// The areas a team row allows: the gym admin everything, Staff what was saved for them (NULL =
// everything, every Staff login before the gym admin edits them), a trainer nothing (no portal)
function areasOf(row) {
  if (row.kind === "owner") return [...AREAS];
  if (row.kind !== "staff") return [];
  let saved = row.permissions;
  if (typeof saved === "string") {
    try {
      saved = JSON.parse(saved);
    } catch {
      return []; // a corrupt value (only ever written with JSON.stringify) locks the login down, never 500s every request
    }
  }
  if (!Array.isArray(saved)) return [...AREAS];
  return AREAS.filter((a) => saved.includes(a));
}

// The area a request under /api/gym needs, or null when every portal login may make it. The path
// is read lower-cased and without a trailing slash, so a spelling the router might still accept
// can never read as "no area" (the gym router is strict too; this is the second lock)
function areaOfPath(path) {
  const normalised = String(path).toLowerCase().replace(/\/+$/, "") || "/";
  const found = AREA_OF_PATH.find(([pattern]) => pattern.test(normalised));
  return found ? found[1] : null;
}

// Why the caller can't change this team member's permissions, or null. target: the gym_staff row
function permissionsProblem(callerId, target) {
  if (target.userId === callerId) return "You can't change your own access.";
  if (target.kind !== "staff") return "Only Staff logins have permissions.";
  return null;
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

module.exports = { KINDS, AREAS, AREA_LABEL, ROLE_FOR, KIND_LABEL, addBody, permissionsBody, areasOf, areaOfPath, permissionsProblem, userIdParam, joinProblem, checkJoin, inviteProblem, removeProblem, roleAfterLeaving, maskPhone };
