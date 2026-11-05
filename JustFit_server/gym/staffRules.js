// Staff / Admin Login's rules (pure, unit-tested): what a gym admin may send, and who may join or
// leave a branch's team. The gym admin (kind 'owner', linked by the justFit Super Admin) adds people
// by their sign-in number as Staff (the gym portal, role gym_admin) or Trainer (the member app with
// their PT clients, role trainer). An account works at branches of one gym only, and is either
// portal staff or a trainer, never both.
const { ValidationError } = require("../profile");
const { ConflictError } = require("../errors");
const { normalizePhone } = require("../auth/phone");

const KINDS = ["staff", "trainer"];
// The role each kind of team member has
const ROLE_FOR = { owner: "gym_admin", staff: "gym_admin", trainer: "trainer" };
const KIND_LABEL = { owner: "Gym admin", staff: "Staff", trainer: "Trainer" };

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// POST /api/gym/staff: { phone, kind }
function addBody(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((key) => !["phone", "kind"].includes(key))) throw new ValidationError("That request has fields we don't use.");
  if (!KINDS.includes(body.kind)) throw new ValidationError("Choose Staff or Trainer.");
  return { phone: normalizePhone(body.phone), kind: body.kind };
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

module.exports = { KINDS, ROLE_FOR, KIND_LABEL, addBody, userIdParam, joinProblem, checkJoin, inviteProblem, removeProblem, roleAfterLeaving, maskPhone };
