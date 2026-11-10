// Super Admin › Meals › Delivery areas (2026-11-10, the user's request "the area the food will be
// delivered will be set by super admin"): the pincodes justFit delivers to (delivery_pincodes),
// added, renamed, switched off and on, or removed here instead of only from the terminal
// (scripts/delivery-pincode.js still works). A member's address outside the active list is saved
// but shown as "not delivering here yet", and checkout refuses it. Each area lists the kitchens
// that serve it, so an area with none can be spotted (orders there have no kitchen to go to).
// Routes are mounted inside /api/admin/kitchen (admins only).
const express = require("express");

const { ValidationError } = require("../profile");
const { NotFoundError, ConflictError } = require("../errors");
const { createRateLimiter, limitPerUser } = require("../rateLimit");
const { recordAdminAction } = require("../admin/overview");
const rules = require("./rules");

const AREA_MAX = 80;

function onlyFields(body, fields) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the area as an object.");
  for (const key of Object.keys(body)) if (!fields.includes(key)) throw new ValidationError("The request has a field we don't expect.");
}
const areaName = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError("The area name must be text.");
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length > AREA_MAX) throw new ValidationError(`Keep the area name to ${AREA_MAX} characters.`);
  return name || null;
};

/** POST { pincode, area? } */
function addBody(body) {
  onlyFields(body, ["pincode", "area"]);
  return { pincode: rules.pincode(body.pincode), area: areaName(body.area) };
}

/** PUT /:pincode { area?, active? }: at least one */
function editBody(body) {
  onlyFields(body, ["area", "active"]);
  if (body.area === undefined && body.active === undefined) throw new ValidationError("Send a new area name or on/off.");
  if (body.active !== undefined && typeof body.active !== "boolean") throw new ValidationError("Say whether deliveries there are on.");
  return { ...(body.area !== undefined ? { area: areaName(body.area) } : {}), ...(body.active !== undefined ? { active: body.active } : {}) };
}

const pincodeParam = (value) => {
  try {
    return rules.pincode(value);
  } catch {
    throw new NotFoundError("That pincode isn't on the list.");
  }
};

/** Every area, active first then by pincode, with the kitchens serving it and how many saved addresses are there */
async function list(pool) {
  const [rows] = await pool.query(
    `SELECT dp.pincode, dp.area, dp.active, (SELECT COUNT(*) FROM user_addresses a WHERE a.pincode = dp.pincode) AS addresses
       FROM delivery_pincodes dp ORDER BY dp.active DESC, dp.pincode`,
  );
  let served = [];
  try {
    [served] = await pool.query("SELECT kp.pincode, k.id, k.name, k.status FROM kitchen_pincodes kp JOIN kitchens k ON k.id = kp.kitchen_id ORDER BY k.name");
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error; // before the kitchens migration: no kitchens to show
  }
  return rows.map((r) => ({
    pincode: r.pincode,
    area: r.area,
    active: Boolean(r.active),
    addresses: Number(r.addresses),
    kitchens: served.filter((k) => k.pincode === r.pincode).map((k) => ({ id: k.id, name: k.name, active: k.status === "active" })),
  }));
}

async function add(pool, { pincode, area }) {
  const [[existing]] = await pool.query("SELECT pincode FROM delivery_pincodes WHERE pincode = ?", [pincode]);
  if (existing) throw new ConflictError(`${pincode} is already on the list.`);
  await pool.query("INSERT INTO delivery_pincodes (pincode, area, active) VALUES (?, ?, 1)", [pincode, area]);
}

async function edit(pool, pincode, changes) {
  const sets = [];
  const params = [];
  if ("area" in changes) { sets.push("area = ?"); params.push(changes.area); }
  if ("active" in changes) { sets.push("active = ?"); params.push(changes.active ? 1 : 0); }
  const [result] = await pool.query(`UPDATE delivery_pincodes SET ${sets.join(", ")} WHERE pincode = ?`, [...params, pincode]);
  if (result.affectedRows === 0) throw new NotFoundError("That pincode isn't on the list.");
}

async function remove(pool, pincode) {
  const [result] = await pool.query("DELETE FROM delivery_pincodes WHERE pincode = ?", [pincode]);
  if (result.affectedRows === 0) throw new NotFoundError("That pincode isn't on the list.");
}

const pool = (req) => req.app.locals.pool;
const smallBody = express.json({ limit: "2kb" });
const changeLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.KITCHEN_CHANGES_PER_HOUR) || 120, windowMs: 60 * 60 * 1000 }));
const route = (handler) => (req, res, next) => handler(req, res).catch(next);
const label = (pincode, area) => (area ? `${pincode} (${area})` : pincode);

const deliveryAreasRouter = express.Router({ caseSensitive: true, strict: true });
deliveryAreasRouter.get("/delivery-areas", route(async (req, res) => {
  res.json({ areas: await list(pool(req)) });
}));
deliveryAreasRouter.post("/delivery-areas", changeLimit, smallBody, route(async (req, res) => {
  const body = addBody(req.body);
  await add(pool(req), body);
  await recordAdminAction(pool(req), req, "meal.delivery_area_add", "meal", body.pincode, `Added delivery area ${label(body.pincode, body.area)}`);
  res.status(201).json({ areas: await list(pool(req)) });
}));
deliveryAreasRouter.put("/delivery-areas/:pincode", changeLimit, smallBody, route(async (req, res) => {
  const pincode = pincodeParam(req.params.pincode);
  const changes = editBody(req.body);
  await edit(pool(req), pincode, changes);
  const what = "active" in changes ? (changes.active ? "Turned on" : "Turned off") : "Renamed";
  await recordAdminAction(pool(req), req, "meal.delivery_area_edit", "meal", pincode, `${what} delivery area ${label(pincode, changes.area)}`);
  res.json({ areas: await list(pool(req)) });
}));
deliveryAreasRouter.delete("/delivery-areas/:pincode", changeLimit, route(async (req, res) => {
  const pincode = pincodeParam(req.params.pincode);
  await remove(pool(req), pincode);
  await recordAdminAction(pool(req), req, "meal.delivery_area_remove", "meal", pincode, `Removed delivery area ${pincode}`);
  res.json({ areas: await list(pool(req)) });
}));

module.exports = { deliveryAreasRouter, addBody, editBody, list, AREA_MAX };
