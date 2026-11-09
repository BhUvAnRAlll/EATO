// Meal payments' rules (pure, unit-tested in __tests__/payment-rules.test.js). justFit pays the way
// Razorpay does (https://razorpay.com/docs/payments/server-integration/nodejs/): the server makes a
// gateway order, the checkout answers with a payment id and a signature, and the signature is
// HMAC-SHA256("<order id>|<payment id>") with the gateway's secret. Only a signature the server
// has checked marks an order paid; the app's word never does.
const crypto = require("node:crypto");
const { ValidationError } = require("../profile");

const PROVIDERS = ["dummy", "razorpay"];
const METHODS = ["upi", "card", "netbanking", "wallet"];
const UNPAID_MINUTES = 15; // an order not paid by then is cancelled by the system
const MAX_ATTEMPTS = 10; // tries on one gateway order
// Razorpay's ids: "order_" or "pay_" and 14 letters and digits
const ORDER_ID = /^order_[A-Za-z0-9]{14}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{14}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A Razorpay-shaped id: "order_" / "pay_" and 14 random letters and digits */
function gatewayId(prefix) {
  let out = "";
  for (let i = 0; i < 14; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${prefix}_${out}`;
}

/** The signature Razorpay's checkout returns for a successful payment */
function signature(secret, providerOrderId, providerPaymentId) {
  return crypto.createHmac("sha256", secret).update(`${providerOrderId}|${providerPaymentId}`).digest("hex");
}

/** Whether the signature is the one for this order and payment (compared in constant time) */
function signatureOk(secret, providerOrderId, providerPaymentId, given) {
  if (typeof given !== "string" || !SIGNATURE.test(given)) return false;
  const expected = Buffer.from(signature(secret, providerOrderId, providerPaymentId), "hex");
  return crypto.timingSafeEqual(expected, Buffer.from(given, "hex"));
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function onlyFields(body, allowed) {
  if (!isObject(body)) throw new ValidationError("Send the details as an object.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}

/** What the checkout handed back, as Razorpay names it: razorpay_order_id, razorpay_payment_id, razorpay_signature */
function verifyBody(body) {
  onlyFields(body, ["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"]);
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = body;
  if (typeof orderId !== "string" || !ORDER_ID.test(orderId)) throw new ValidationError("That payment order isn't valid.");
  if (typeof paymentId !== "string" || !PAYMENT_ID.test(paymentId)) throw new ValidationError("That payment isn't valid.");
  if (typeof sig !== "string" || !SIGNATURE.test(sig)) throw new ValidationError("That payment's signature isn't valid.");
  return { providerOrderId: orderId, providerPaymentId: paymentId, signature: sig };
}

/** A failed or closed checkout, so the order shows why: { razorpay_order_id, reason } */
function failureBody(body) {
  onlyFields(body, ["razorpay_order_id", "reason"]);
  if (typeof body.razorpay_order_id !== "string" || !ORDER_ID.test(body.razorpay_order_id)) throw new ValidationError("That payment order isn't valid.");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  return { providerOrderId: body.razorpay_order_id, reason: reason || "Payment not completed" };
}

/** The dummy gateway's checkout: which order, which method, and whether it succeeds */
function dummyCheckoutBody(body) {
  onlyFields(body, ["razorpay_order_id", "method", "outcome"]);
  if (typeof body.razorpay_order_id !== "string" || !ORDER_ID.test(body.razorpay_order_id)) throw new ValidationError("That payment order isn't valid.");
  if (!METHODS.includes(body.method)) throw new ValidationError("Pick UPI, card, netbanking or a wallet.");
  if (!["success", "failure"].includes(body.outcome)) throw new ValidationError("Outcome must be success or failure.");
  return { providerOrderId: body.razorpay_order_id, method: body.method, outcome: body.outcome };
}

/**
 * Which provider pays: PAYMENT_PROVIDER, "dummy" by default. Razorpay needs its key id and secret;
 * without them it is refused at startup rather than at the first Pay.
 */
function providerSettings(env = process.env) {
  const name = (env.PAYMENT_PROVIDER || "dummy").trim().toLowerCase();
  if (!PROVIDERS.includes(name)) throw new Error(`PAYMENT_PROVIDER must be ${PROVIDERS.join(" or ")}.`);
  if (name === "razorpay") {
    const keyId = (env.RAZORPAY_KEY_ID || "").trim();
    const keySecret = (env.RAZORPAY_KEY_SECRET || "").trim();
    if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId) || keySecret.length < 16) throw new Error("PAYMENT_PROVIDER=razorpay needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
    return { name, keyId, keySecret };
  }
  return { name, keyId: "rzp_test_justfitdummy", keySecret: null };
}

/** The dummy's secret: HKDF from AUTH_SECRET with its own label, never stored or sent */
function dummySecret(authSecret) {
  return Buffer.from(crypto.hkdfSync("sha256", authSecret, "justfit-dummy-payments", "dummy gateway v1", 32)).toString("hex");
}

/** What the app's checkout opens with (Razorpay's checkout options, nothing secret) */
function checkoutOptions({ provider, keyId, providerOrderId, amountPaise, currency, orderCode, contact, name }) {
  return {
    provider,
    key: keyId,
    order_id: providerOrderId,
    amount: amountPaise,
    currency,
    name: "justFit",
    description: `Meal order ${orderCode}`,
    prefill: { contact: contact ? `+91${contact}` : null, name: name || null },
    theme: { color: "#20BF65" },
  };
}

module.exports = {
  PROVIDERS, METHODS, UNPAID_MINUTES, MAX_ATTEMPTS, ORDER_ID, PAYMENT_ID,
  gatewayId, signature, signatureOk, verifyBody, failureBody, dummyCheckoutBody, providerSettings, dummySecret, checkoutOptions,
};
