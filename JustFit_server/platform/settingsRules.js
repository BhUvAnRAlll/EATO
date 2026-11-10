// justFit-wide settings the Super Admin changes (Gym Hub ecosystem, the brief's section 7): pure,
// unit-tested. Each setting has a default used until it is saved; a branch's own pause policy or
// crowd levels still win over these defaults.
const { ValidationError } = require("../profile");
const standingRules = require("../gym/standingRules");
const crowdRules = require("../gym/crowdRules");

const DOCUMENT_KINDS = ["registration", "address", "other"];
const DEFAULTS = {
  registrationOpen: true,
  requiredDocuments: ["address"],
  pausePolicy: { ...standingRules.POLICY_DEFAULT },
  crowdThresholds: { ...crowdRules.CROWD.defaultThresholds },
  // Members are told when justFit answers their complaint about a gym (2026-11-10: members don't
  // switch notifications; the Super Admin decides this one, gyms the membership ones)
  memberComplaintUpdates: true,
};
const KEYS = Object.keys(DEFAULTS);

/** The settings from their stored rows [{ setting_key, value }], with defaults for the rest */
function read(rows) {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const r of rows ?? []) {
    let value = r.value;
    try {
      if (typeof value === "string") value = JSON.parse(value);
    } catch {
      continue;
    }
    if (r.setting_key === "registrationOpen" && typeof value === "boolean") out.registrationOpen = value;
    if (r.setting_key === "requiredDocuments" && Array.isArray(value)) out.requiredDocuments = DOCUMENT_KINDS.filter((k) => value.includes(k));
    if (r.setting_key === "pausePolicy") out.pausePolicy = standingRules.readPolicy(value);
    if (r.setting_key === "crowdThresholds") out.crowdThresholds = crowdRules.settingsOf({ crowd_thresholds: value }).thresholds;
    if (r.setting_key === "memberComplaintUpdates" && typeof value === "boolean") out.memberComplaintUpdates = value;
  }
  return out;
}

/** PUT /api/admin/portal/platform-settings: any of the settings, each checked */
function settingsBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the settings as JSON.");
  if (Object.keys(body).some((k) => !KEYS.includes(k))) throw new ValidationError("That request has settings we don't use.");
  const out = {};
  if (body.registrationOpen !== undefined) {
    if (typeof body.registrationOpen !== "boolean") throw new ValidationError("Turn gym registration on or off.");
    out.registrationOpen = body.registrationOpen;
  }
  if (body.requiredDocuments !== undefined) {
    if (!Array.isArray(body.requiredDocuments) || body.requiredDocuments.some((k) => !DOCUMENT_KINDS.includes(k))) throw new ValidationError("Pick documents from the list.");
    out.requiredDocuments = DOCUMENT_KINDS.filter((k) => body.requiredDocuments.includes(k));
  }
  if (body.pausePolicy !== undefined) {
    const fields = standingRules.policyBody(body.pausePolicy);
    out.pausePolicy = { ...DEFAULTS.pausePolicy, ...fields };
    if (out.pausePolicy.maxDaysPerYear !== null && out.pausePolicy.maxDaysEach > out.pausePolicy.maxDaysPerYear) throw new ValidationError("The longest pause can't be more than the days a year.");
  }
  if (body.crowdThresholds !== undefined) out.crowdThresholds = crowdRules.settingsBody({ thresholds: body.crowdThresholds }).thresholds;
  if (body.memberComplaintUpdates !== undefined) {
    if (typeof body.memberComplaintUpdates !== "boolean") throw new ValidationError("Turn complaint updates to members on or off.");
    out.memberComplaintUpdates = body.memberComplaintUpdates;
  }
  if (Object.keys(out).length === 0) throw new ValidationError("Change at least one setting.");
  return out;
}

module.exports = { DEFAULTS, KEYS, DOCUMENT_KINDS, read, settingsBody };
