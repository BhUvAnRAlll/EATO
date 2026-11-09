// Meal payments (2026-11-10), the Razorpay flow end to end:
//   1. Pay: meals/service.placeOrder saves the order as awaiting_payment, then openPayment makes the
//      gateway order (meal_payments) and returns the checkout's options.
//   2. The app's checkout pays (the dummy's: dummyCheckout below, standing in for Razorpay's servers)
//      and hands back razorpay_order_id, razorpay_payment_id and razorpay_signature.
//   3. verify checks the signature with the gateway's secret and, only then, marks the payment paid
//      and the order placed, in one transaction with the payment row locked.
// Orders not paid within 15 minutes are cancelled by the system (expireUnpaid). Before migration
// 2026-12-28 nothing here runs and orders keep the old test payment (ready() is false).
const { ConflictError, NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const { inTransaction } = require("../gym/service");
const { logSecurityEvent } = require("../logging");
const { gateway } = require("./providers");
const rules = require("./rules");

// Whether migration 2026-12-28 has run, checked at most once a minute
let readyCache = { at: 0, value: false };
async function ready(pool) {
  if (Date.now() - readyCache.at < 60_000) return readyCache.value;
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'meal_payments'",
  );
  readyCache = { at: Date.now(), value: Number(row.n) > 0 };
  return readyCache.value;
}

/** Cancels orders still unpaid after 15 minutes (all members), so the kitchen never sees them */
async function expireUnpaid(db) {
  await db.query(
    `UPDATE orders SET status = 'cancelled', cancelled_by = 'system', cancel_reason = 'Payment not completed'
     WHERE status = 'awaiting_payment' AND created_at < NOW() - INTERVAL ${rules.UNPAID_MINUTES} MINUTE`,
  );
}

/**
 * The checkout's options for an order waiting for payment: its open gateway order, or a new one.
 * The amount is always the order's own total from the database.
 */
async function openPayment(pool, userId, order) {
  const gw = gateway();
  const [[open]] = await pool.query(
    `SELECT provider_order_id, amount_paise, currency FROM meal_payments
     WHERE order_id = ? AND user_id = ? AND provider = ? AND status <> 'paid' AND attempts < ? ORDER BY created_at DESC LIMIT 1`,
    [order.id, userId, gw.name, rules.MAX_ATTEMPTS],
  );
  let payment = open;
  if (!payment) {
    const made = await gw.createOrder({ amountPaise: order.totalPaise, currency: "INR", receipt: `jf_${order.id.slice(0, 8)}` });
    if (made.amount !== order.totalPaise) throw new Error("The gateway order's amount differs from the order's");
    await pool.query(
      "INSERT INTO meal_payments (order_id, user_id, provider, provider_order_id, amount_paise, currency) VALUES (?, ?, ?, ?, ?, ?)",
      [order.id, userId, gw.name, made.id, made.amount, made.currency],
    );
    payment = { provider_order_id: made.id, amount_paise: made.amount, currency: made.currency };
  }
  return rules.checkoutOptions({
    provider: gw.name,
    keyId: gw.keyId,
    providerOrderId: payment.provider_order_id,
    amountPaise: Number(payment.amount_paise),
    currency: payment.currency,
    orderCode: order.id.slice(0, 8).toUpperCase(),
    contact: order.receiverPhone,
    name: order.receiverName,
  });
}

// The payment row for this member's order, locked (404 when it isn't theirs)
async function lockedPayment(db, userId, orderId, providerOrderId) {
  const [[row]] = await db.query(
    `SELECT p.id, p.provider, p.status, p.provider_payment_id, p.attempts, o.status AS order_status, o.cancelled_by
     FROM meal_payments p JOIN orders o ON o.id = p.order_id
     WHERE p.provider_order_id = ? AND p.order_id = ? AND p.user_id = ? FOR UPDATE`,
    [providerOrderId, orderId, userId],
  );
  if (!row) throw new NotFoundError("That payment isn't on your order.");
  return row;
}

/**
 * Checks what the checkout returned and, when the signature is right, marks the payment paid and
 * the order placed. The same payment again answers as before (a retried request). An order the
 * system cancelled for slowness is placed again while its meal time is still open (`slotOpen`);
 * otherwise the payment is kept as paid and the member is told it will be refunded.
 */
async function verify(pool, userId, orderId, body, { slotOpen }) {
  const gw = gateway();
  return inTransaction(pool, async (db) => {
    const row = await lockedPayment(db, userId, orderId, body.providerOrderId);
    if (row.status === "paid") {
      if (row.provider_payment_id === body.providerPaymentId) return { alreadyPaid: true };
      throw new ConflictError("This order is already paid.");
    }
    if (row.provider !== gw.name || !rules.signatureOk(gw.secret(), body.providerOrderId, body.providerPaymentId, body.signature)) {
      logSecurityEvent("payment.bad_signature", { userId, orderId });
      throw new ValidationError("We couldn't confirm this payment. If money was taken, it will be refunded.");
    }
    await db.query(
      "UPDATE meal_payments SET status = 'paid', provider_payment_id = ?, failure_reason = NULL, attempts = attempts + 1, paid_at = NOW() WHERE id = ?",
      [body.providerPaymentId, row.id],
    );
    const waiting = row.order_status === "awaiting_payment" || (row.order_status === "cancelled" && row.cancelled_by === "system" && (await slotOpen(db, orderId)));
    if (!waiting) throw new PaidTooLateError();
    await db.query(
      "UPDATE orders SET status = 'placed', cancelled_by = NULL, cancel_reason = NULL, payment_ref = ? WHERE id = ?",
      [body.providerPaymentId, orderId],
    );
    return { alreadyPaid: false };
  }).catch(async (error) => {
    // Keep the money's record even though the order can't be placed: mark it paid outside the
    // rolled-back transaction, then tell the member
    if (error instanceof PaidTooLateError) {
      await pool.query(
        "UPDATE meal_payments SET status = 'paid', provider_payment_id = ?, failure_reason = 'Paid after the order closed: refund', paid_at = NOW() WHERE provider_order_id = ? AND user_id = ? AND status <> 'paid'",
        [body.providerPaymentId, body.providerOrderId, userId],
      );
      throw new ConflictError("Your payment came after this order closed, so it will be refunded. Please place a new order.");
    }
    throw error;
  });
}
class PaidTooLateError extends Error {}

/** A checkout that failed or was closed: the attempt is kept with its reason; the order still waits */
async function fail(pool, userId, orderId, body) {
  const [result] = await pool.query(
    `UPDATE meal_payments p JOIN orders o ON o.id = p.order_id
     SET p.status = 'failed', p.failure_reason = ?, p.attempts = p.attempts + 1
     WHERE p.provider_order_id = ? AND p.order_id = ? AND p.user_id = ? AND p.status <> 'paid'`,
    [body.reason, body.providerOrderId, orderId, userId],
  );
  if (result.affectedRows === 0) throw new NotFoundError("That payment isn't waiting on your order.");
  return { recorded: true };
}

/**
 * The dummy gateway (only while PAYMENT_PROVIDER is the dummy): what Razorpay's servers do when the
 * member pays in its checkout. Success answers like Razorpay's handler (payment id, order id and the
 * signature made with the dummy's secret); failure answers like its payment.failed event. No money
 * moves. Only the member's own open payment can be paid.
 */
async function dummyCheckout(pool, userId, body) {
  const gw = gateway();
  if (gw.name !== "dummy") throw new NotFoundError("Not found.");
  const [[row]] = await pool.query(
    `SELECT p.id, p.status, p.attempts, o.status AS order_status FROM meal_payments p JOIN orders o ON o.id = p.order_id
     WHERE p.provider_order_id = ? AND p.user_id = ? AND p.provider = 'dummy'`,
    [body.providerOrderId, userId],
  );
  if (!row) throw new NotFoundError("That payment isn't on your account.");
  if (row.status === "paid") throw new ConflictError("This order is already paid.");
  if (row.order_status !== "awaiting_payment") throw new ConflictError("This order is no longer waiting for payment. Please place it again.");
  if (row.attempts >= rules.MAX_ATTEMPTS) throw new ConflictError("Too many tries on this payment. Please place the order again.");
  if (body.outcome === "failure") {
    const description = "Your payment didn't go through. No money was taken. (Test payment)";
    await pool.query("UPDATE meal_payments SET status = 'failed', method = ?, failure_reason = ?, attempts = attempts + 1 WHERE id = ?", [body.method, description, row.id]);
    return { status: "failed", error: { code: "BAD_REQUEST_ERROR", description, reason: "payment_failed", metadata: { order_id: body.providerOrderId } } };
  }
  const paymentId = rules.gatewayId("pay");
  await pool.query("UPDATE meal_payments SET method = ? WHERE id = ?", [body.method, row.id]);
  return {
    status: "captured",
    razorpay_payment_id: paymentId,
    razorpay_order_id: body.providerOrderId,
    razorpay_signature: rules.signature(gw.secret(), body.providerOrderId, paymentId),
  };
}

/** The gateway new orders are paid through ("dummy" or "razorpay") */
const providerName = () => gateway().name;

module.exports = { ready, expireUnpaid, openPayment, verify, fail, dummyCheckout, providerName };
