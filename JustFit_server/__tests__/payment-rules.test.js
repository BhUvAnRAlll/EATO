// Meal payments' pure rules (payments/rules.js): Razorpay-shaped ids, the signature and its check,
// the bodies the app sends, and which provider is configured.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");

const rules = require("../payments/rules");
const { ValidationError } = require("../profile");

const SECRET = "0123456789abcdef0123456789abcdef";

describe("payment rules", () => {
  it("makes Razorpay-shaped ids", () => {
    assert.match(rules.gatewayId("order"), /^order_[A-Za-z0-9]{14}$/);
    assert.match(rules.gatewayId("pay"), /^pay_[A-Za-z0-9]{14}$/);
    assert.notEqual(rules.gatewayId("pay"), rules.gatewayId("pay"));
  });

  it("signs as Razorpay does and checks the signature in constant time", () => {
    const sig = rules.signature(SECRET, "order_ABCDEFGHIJ1234", "pay_ABCDEFGHIJ1234");
    const expected = crypto.createHmac("sha256", SECRET).update("order_ABCDEFGHIJ1234|pay_ABCDEFGHIJ1234").digest("hex");
    assert.equal(sig, expected);
    assert.equal(rules.signatureOk(SECRET, "order_ABCDEFGHIJ1234", "pay_ABCDEFGHIJ1234", sig), true);
    assert.equal(rules.signatureOk(SECRET, "order_ABCDEFGHIJ1234", "pay_ZZZZZZZZZZ1234", sig), false, "another payment");
    assert.equal(rules.signatureOk("another-secret-another-secret-xx", "order_ABCDEFGHIJ1234", "pay_ABCDEFGHIJ1234", sig), false, "another secret");
    assert.equal(rules.signatureOk(SECRET, "order_ABCDEFGHIJ1234", "pay_ABCDEFGHIJ1234", sig.toUpperCase()), false, "not lower-case hex");
    assert.equal(rules.signatureOk(SECRET, "order_ABCDEFGHIJ1234", "pay_ABCDEFGHIJ1234", "abc"), false);
    assert.equal(rules.signatureOk(SECRET, "order_ABCDEFGHIJ1234", "pay_ABCDEFGHIJ1234", null), false);
  });

  it("reads the checkout's answer and refuses anything else", () => {
    const sig = "a".repeat(64);
    assert.deepEqual(rules.verifyBody({ razorpay_order_id: "order_ABCDEFGHIJ1234", razorpay_payment_id: "pay_ABCDEFGHIJ1234", razorpay_signature: sig }), {
      providerOrderId: "order_ABCDEFGHIJ1234", providerPaymentId: "pay_ABCDEFGHIJ1234", signature: sig,
    });
    for (const bad of [
      null, [], "x",
      { razorpay_order_id: "order_1' OR 1=1 --", razorpay_payment_id: "pay_ABCDEFGHIJ1234", razorpay_signature: sig },
      { razorpay_order_id: "order_ABCDEFGHIJ1234", razorpay_payment_id: "pay_short", razorpay_signature: sig },
      { razorpay_order_id: "order_ABCDEFGHIJ1234", razorpay_payment_id: "pay_ABCDEFGHIJ1234", razorpay_signature: "z".repeat(64) },
      { razorpay_order_id: "order_ABCDEFGHIJ1234", razorpay_payment_id: "pay_ABCDEFGHIJ1234", razorpay_signature: sig, paid: true },
    ]) assert.throws(() => rules.verifyBody(bad), ValidationError);
  });

  it("reads failures and the dummy checkout's body", () => {
    assert.deepEqual(rules.failureBody({ razorpay_order_id: "order_ABCDEFGHIJ1234" }), { providerOrderId: "order_ABCDEFGHIJ1234", reason: "Payment not completed" });
    assert.equal(rules.failureBody({ razorpay_order_id: "order_ABCDEFGHIJ1234", reason: "x".repeat(400) }).reason.length, 200);
    assert.throws(() => rules.failureBody({ razorpay_order_id: "nope" }), ValidationError);
    assert.deepEqual(rules.dummyCheckoutBody({ razorpay_order_id: "order_ABCDEFGHIJ1234", method: "upi", outcome: "success" }), { providerOrderId: "order_ABCDEFGHIJ1234", method: "upi", outcome: "success" });
    assert.throws(() => rules.dummyCheckoutBody({ razorpay_order_id: "order_ABCDEFGHIJ1234", method: "cash", outcome: "success" }), ValidationError);
    assert.throws(() => rules.dummyCheckoutBody({ razorpay_order_id: "order_ABCDEFGHIJ1234", method: "upi", outcome: "maybe" }), ValidationError);
    assert.throws(() => rules.dummyCheckoutBody({ razorpay_order_id: "order_ABCDEFGHIJ1234", method: "upi", outcome: "success", amount: 1 }), ValidationError);
  });

  it("picks the provider: the dummy by default, Razorpay only with its keys", () => {
    assert.equal(rules.providerSettings({}).name, "dummy");
    assert.equal(rules.providerSettings({ PAYMENT_PROVIDER: " Dummy " }).name, "dummy");
    assert.throws(() => rules.providerSettings({ PAYMENT_PROVIDER: "paypal" }), /PAYMENT_PROVIDER/);
    assert.throws(() => rules.providerSettings({ PAYMENT_PROVIDER: "razorpay" }), /RAZORPAY_KEY_ID/);
    const live = rules.providerSettings({ PAYMENT_PROVIDER: "razorpay", RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: "s".repeat(24) });
    assert.equal(live.name, "razorpay");
    assert.equal(live.keyId, "rzp_test_abc123");
  });

  it("derives the dummy's secret from AUTH_SECRET and builds the checkout's options", () => {
    const a = rules.dummySecret("x".repeat(40));
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, rules.dummySecret("x".repeat(40)));
    assert.notEqual(a, rules.dummySecret("y".repeat(40)));
    const options = rules.checkoutOptions({ provider: "dummy", keyId: "rzp_test_justfitdummy", providerOrderId: "order_ABCDEFGHIJ1234", amountPaise: 45900, currency: "INR", orderCode: "AB12CD34", contact: "9876543210", name: "Asha" });
    assert.equal(options.amount, 45900);
    assert.equal(options.order_id, "order_ABCDEFGHIJ1234");
    assert.equal(options.prefill.contact, "+919876543210");
    assert.equal(options.description, "Meal order AB12CD34");
    assert.equal(JSON.stringify(options).includes(a), false, "no secret in the options");
  });
});
