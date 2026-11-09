// Gym roles (Gym Hub ecosystem, the user's brief of 2026-11-09): pure, unit-tested. The brief's gym
// roles are Gym Owner, Gym Admin, Manager, Receptionist, Trainer and Attendance Staff. The owner is
// the gym admin who runs the branch (gym_staff kind 'owner'); a trainer has their own kind. The
// others are Staff logins with a ready-made set of Role & Permission options, so one permission
// system stays the source of truth: picking a role ticks its options, and the gym admin can still
// change any of them (the login then reads as "Custom").
const { OPTION_IDS } = require("./staffRules");

const all = () => [...OPTION_IDS];
const without = (ids) => OPTION_IDS.filter((id) => !ids.includes(id));

// null options: every option, now and later (stored as NULL, as Staff were before)
const PRESETS = [
  { id: "admin", label: "Gym Admin", text: "Everything except the team and branches", options: null },
  {
    id: "manager",
    label: "Manager",
    text: "Day-to-day running, without settings",
    options: without(["attendance.settings", "sms.auto", "catalog.edit", "profile.publish", "predictions.revenue", "payments.wallet"]),
  },
  {
    id: "receptionist",
    label: "Receptionist",
    text: "Members, payments at the desk, enquiries and check-ins",
    options: [
      "home.today", "members.view", "members.add", "members.edit", "members.renew", "members.pause",
      "payments.collect", "payments.pt", "payments.sales", "enquiries.view", "enquiries.edit", "enquiries.contacts",
      "catalog.view", "attendance.view", "attendance.checkin", "sms.view", "templates.view",
    ],
  },
  { id: "attendance", label: "Attendance Staff", text: "Check members in and out", options: ["members.view", "attendance.view", "attendance.checkin"] },
];
const PRESET_IDS = PRESETS.map((p) => p.id);
for (const p of PRESETS) for (const id of p.options ?? []) if (!OPTION_IDS.includes(id)) throw new Error(`Role preset ${p.id} names an unknown option ${id}`);

/** The options a preset gives (null: every option) */
function presetOptions(id) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return undefined;
  return preset.options === null ? null : OPTION_IDS.filter((o) => preset.options.includes(o));
}

/**
 * Which role a team row reads as: owner, trainer, one of the presets when its options match exactly,
 * else custom. options: the row's stored list (null = every option, i.e. Gym Admin).
 */
function roleOf(kind, options) {
  if (kind === "owner") return "owner";
  if (kind === "trainer") return "trainer";
  if (options === null || options === undefined) return "admin";
  const set = [...new Set(options)].sort().join(",");
  for (const p of PRESETS) {
    const want = (p.options === null ? all() : p.options).slice().sort().join(",");
    if (want === set) return p.id;
  }
  return "custom";
}

const ROLE_LABEL = { owner: "Gym Owner", trainer: "Trainer", custom: "Custom", ...Object.fromEntries(PRESETS.map((p) => [p.id, p.label])) };

/** For the app: the presets as chips */
const presetList = () => PRESETS.map((p) => ({ id: p.id, label: p.label, text: p.text, options: p.options === null ? all() : p.options }));

module.exports = { PRESETS, PRESET_IDS, ROLE_LABEL, presetOptions, roleOf, presetList };
