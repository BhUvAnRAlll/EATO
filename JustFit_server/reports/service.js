// Meal operations reports (Meal Operations phase 6, 2026-11-10): one India date range (at most 92
// days) of business, kitchen, delivery and subscription numbers, read from orders, order events,
// stock moves, deliveries and subscriptions. Parts whose migration hasn't run are null. Admin only.
const { ValidationError } = require("../profile");
const xlsx = require("../gym/xlsx");
const kitchenRules = require("../kitchens/rules");

const num = (v) => Number(v ?? 0);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAID_ONLY = "o.status <> 'awaiting_payment' AND (o.cancelled_by IS NULL OR o.cancelled_by <> 'system')";
const dayOf = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));

/** ?from=&to=&format= — a range of at most 92 India days ending today at the latest; the last 30 days by default */
function rangeQuery(query, now = Date.now()) {
  kitchenRules.onlyFields(query, ["from", "to", "format"]);
  const today = kitchenRules.indiaNow(now).date;
  const to = query.to ?? today;
  const from = query.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  for (const d of [from, to]) if (typeof d !== "string" || !DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new ValidationError("Pick the days like 2026-11-10.");
  if (from > to) throw new ValidationError("The first day can't be after the last.");
  if (to > today) throw new ValidationError("Reports end today at the latest.");
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 91) throw new ValidationError("Pick at most 92 days.");
  const format = query.format ?? null;
  if (format !== null && !["xlsx", "csv"].includes(format)) throw new ValidationError("Format must be xlsx or csv.");
  return { from, to, format, start: kitchenRules.dayBounds(from).start, end: kitchenRules.dayBounds(to).end };
}

async function tableExists(pool, name) {
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [name]);
  return num(row.n) > 0;
}
async function columnExists(pool, table, column) {
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", [table, column]);
  return num(row.n) > 0;
}

async function report(pool, { from, to, start, end }) {
  const withSubs = await columnExists(pool, "orders", "subscription_id");
  const withKitchens = await columnExists(pool, "orders", "kitchen_id");
  const subCol = withSubs ? "o.subscription_id" : "NULL";

  // Business: paid orders placed in the range (by when they were placed), revenue, a series a day
  const [daily] = await pool.query(
    `SELECT DATE(CONVERT_TZ(o.created_at, @@session.time_zone, '+05:30')) AS d, COUNT(*) AS orders, SUM(${subCol} IS NULL) AS individual,
       SUM(CASE WHEN o.status <> 'cancelled' THEN o.total_paise ELSE 0 END) AS paise
     FROM orders o WHERE o.created_at >= FROM_UNIXTIME(?) AND o.created_at < FROM_UNIXTIME(?) AND ${PAID_ONLY} GROUP BY d ORDER BY d`,
    [start, end],
  );
  const totals = daily.reduce((t, r) => ({ orders: t.orders + num(r.orders), individual: t.individual + num(r.individual), paise: t.paise + num(r.paise) }), { orders: 0, individual: 0, paise: 0 });
  let subscriptionRevenue = null;
  if (await tableExists(pool, "meal_subscriptions")) {
    const [[s]] = await pool.query(
      "SELECT COALESCE(SUM(price_paise), 0) AS paise FROM meal_subscriptions WHERE payment_method IS NOT NULL AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)",
      [start, end],
    );
    subscriptionRevenue = Math.round(num(s.paise) / 100);
  }
  const business = {
    revenue: Math.round(totals.paise / 100),
    subscriptionRevenue,
    orders: totals.orders,
    individualOrders: totals.individual,
    subscriptionOrders: totals.orders - totals.individual,
    averageOrder: totals.individual > 0 ? Math.round(totals.paise / 100 / totals.individual) : null,
    days: daily.map((r) => ({ day: dayOf(r.d), orders: num(r.orders), revenue: Math.round(num(r.paise) / 100) })),
  };

  // Kitchens: orders delivered in the range per kitchen, preparation time (accepted → ready), waste
  let kitchens = null;
  if (withKitchens) {
    const [rows] = await pool.query(
      `SELECT k.id, k.name, k.max_daily_orders,
         (SELECT COUNT(*) FROM orders o WHERE o.kitchen_id = k.id AND o.delivery_date BETWEEN ? AND ? AND ${PAID_ONLY}) AS orders,
         (SELECT COUNT(*) FROM orders o WHERE o.kitchen_id = k.id AND o.delivery_date BETWEEN ? AND ? AND o.status = 'delivered') AS delivered,
         (SELECT AVG(TIMESTAMPDIFF(MINUTE, a.created_at, r.created_at)) FROM orders o
            JOIN order_events a ON a.order_id = o.id AND a.status = 'accepted' JOIN order_events r ON r.order_id = o.id AND r.status = 'ready'
            WHERE o.kitchen_id = k.id AND o.delivery_date BETWEEN ? AND ?) AS prep_minutes,
         (SELECT COALESCE(SUM(-m.quantity * COALESCE(s.unit_price_paise, 0)), 0) FROM stock_moves m
            LEFT JOIN kitchen_stock s ON s.kitchen_id = m.kitchen_id AND s.ingredient_id = m.ingredient_id
            WHERE m.kitchen_id = k.id AND m.kind = 'waste' AND m.created_at >= FROM_UNIXTIME(?) AND m.created_at < FROM_UNIXTIME(?)) AS waste_paise,
         (SELECT COALESCE(SUM(-m.quantity * COALESCE(s.unit_price_paise, 0)), 0) FROM stock_moves m
            LEFT JOIN kitchen_stock s ON s.kitchen_id = m.kitchen_id AND s.ingredient_id = m.ingredient_id
            WHERE m.kitchen_id = k.id AND m.kind = 'use' AND m.created_at >= FROM_UNIXTIME(?) AND m.created_at < FROM_UNIXTIME(?)) AS used_paise
       FROM kitchens k ORDER BY k.name`,
      [from, to, from, to, from, to, start, end, start, end],
    );
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    kitchens = rows.map((r) => ({
      id: num(r.id), name: r.name, orders: num(r.orders), delivered: num(r.delivered),
      prepMinutes: r.prep_minutes === null ? null : Math.round(num(r.prep_minutes)),
      waste: Math.round(num(r.waste_paise) / 100), used: Math.round(num(r.used_paise) / 100),
      utilization: Math.round((num(r.orders) / Math.max(1, num(r.max_daily_orders) * days)) * 100),
    }));
  }

  // Delivery: deliveries assigned in the range, how they ended, time from pick-up to the door
  let delivery = null;
  if (await tableExists(pool, "deliveries")) {
    const [[d]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'delivered') AS delivered, SUM(status = 'failed') AS failed,
         AVG(CASE WHEN status = 'delivered' THEN TIMESTAMPDIFF(MINUTE, picked_up_at, delivered_at) END) AS minutes
       FROM deliveries WHERE assigned_at >= FROM_UNIXTIME(?) AND assigned_at < FROM_UNIXTIME(?)`,
      [start, end],
    );
    const [partners] = await pool.query(
      `SELECT p.name, SUM(d.status = 'delivered') AS delivered, SUM(d.status = 'failed') AS failed,
         AVG(CASE WHEN d.status = 'delivered' THEN TIMESTAMPDIFF(MINUTE, d.picked_up_at, d.delivered_at) END) AS minutes
       FROM deliveries d JOIN delivery_partners p ON p.id = d.partner_id
       WHERE d.assigned_at >= FROM_UNIXTIME(?) AND d.assigned_at < FROM_UNIXTIME(?) GROUP BY p.id, p.name ORDER BY delivered DESC LIMIT 50`,
      [start, end],
    );
    delivery = {
      total: num(d.total), delivered: num(d.delivered), failed: num(d.failed), averageMinutes: d.minutes === null ? null : Math.round(num(d.minutes)),
      partners: partners.map((p) => ({ name: p.name, delivered: num(p.delivered), failed: num(p.failed), averageMinutes: p.minutes === null ? null : Math.round(num(p.minutes)) })),
    };
  }

  // Subscriptions: started, cancelled and completed in the range; running now; meals delivered of planned
  let subscriptions = null;
  if (await tableExists(pool, "meal_subscriptions")) {
    const today = kitchenRules.indiaNow().date;
    const [[s]] = await pool.query(
      `SELECT
         SUM(payment_method IS NOT NULL AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)) AS started,
         SUM(status = 'cancelled' AND payment_method IS NOT NULL AND updated_at >= FROM_UNIXTIME(?) AND updated_at < FROM_UNIXTIME(?)) AS cancelled,
         SUM(status = 'completed') AS completed,
         SUM(status = 'active' AND ends_on >= ?) AS active,
         SUM(status = 'active' AND paused_from <= ? AND paused_until >= ?) AS paused
       FROM meal_subscriptions`,
      [start, end, start, end, today, today, today],
    );
    const [[used]] = await pool.query(
      `SELECT COUNT(*) AS planned, SUM(o.status = 'delivered') AS delivered FROM orders o WHERE o.subscription_id IS NOT NULL AND o.delivery_date BETWEEN ? AND ?`,
      [from, to],
    );
    subscriptions = {
      started: num(s.started), cancelled: num(s.cancelled), completed: num(s.completed), active: num(s.active), paused: num(s.paused),
      mealsMade: num(used.planned), mealsDelivered: num(used.delivered),
      utilization: num(used.planned) > 0 ? Math.round((num(used.delivered) / num(used.planned)) * 100) : null,
    };
  }

  return { from, to, business, kitchens, delivery, subscriptions };
}

/** The report as one sheet (xlsx) or CSV: a section a block, a row a figure */
function exportReport(r, format) {
  const rows = [
    ["Business", "Revenue (₹)", r.business.revenue], ["Business", "Subscription revenue (₹)", r.business.subscriptionRevenue ?? ""],
    ["Business", "Orders", r.business.orders], ["Business", "Individual orders", r.business.individualOrders], ["Business", "Subscription orders", r.business.subscriptionOrders],
    ["Business", "Average order (₹)", r.business.averageOrder ?? ""],
    ...r.business.days.map((d) => ["Day", d.day, `${d.orders} orders · ₹${d.revenue}`]),
    ...(r.kitchens ?? []).map((k) => ["Kitchen", k.name, `${k.orders} orders · ${k.delivered} delivered · prep ${k.prepMinutes ?? "-"} min · waste ₹${k.waste} · ${k.utilization}% of capacity`]),
    ...(r.delivery ? [["Delivery", "Deliveries", r.delivery.total], ["Delivery", "Delivered", r.delivery.delivered], ["Delivery", "Failed", r.delivery.failed], ["Delivery", "Average minutes", r.delivery.averageMinutes ?? ""]] : []),
    ...(r.delivery?.partners ?? []).map((p) => ["Partner", p.name, `${p.delivered} delivered · ${p.failed} failed · ${p.averageMinutes ?? "-"} min`]),
    ...(r.subscriptions ? [["Subscriptions", "Started", r.subscriptions.started], ["Subscriptions", "Active now", r.subscriptions.active], ["Subscriptions", "Paused now", r.subscriptions.paused],
      ["Subscriptions", "Cancelled", r.subscriptions.cancelled], ["Subscriptions", "Completed", r.subscriptions.completed], ["Subscriptions", "Meals delivered of made", `${r.subscriptions.mealsDelivered} of ${r.subscriptions.mealsMade}`]] : []),
  ];
  const header = ["Section", "Figure", "Value"];
  const name = `meal-report-${r.from}-to-${r.to}`;
  if (format === "csv") {
    const cell = (v) => {
      const t = v === null || v === undefined ? "" : String(v);
      const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return { name: `${name}.csv`, type: "text/csv; charset=utf-8", body: Buffer.from(`﻿${[header, ...rows].map((row) => row.map(cell).join(",")).join("\n")}\n`) };
  }
  return { name: `${name}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: xlsx.workbook({ sheetName: "Report", header, rows, widths: [14, 28, 60] }) };
}

module.exports = { rangeQuery, report, exportReport };
