// The payment gateways behind one shape (2026-11-10). createOrder makes the gateway order and
// secret() is what its signatures are checked with. The dummy plays Razorpay's part on this
// server (payments/routes.js) and takes no money; Razorpay is called over its REST API with the
// key id and secret from JustFit_server/.env (never sent to the app beyond the public key id).
const rules = require("./rules");

function dummy(settings, authSecret) {
  const secret = rules.dummySecret(authSecret);
  return {
    name: "dummy",
    keyId: settings.keyId,
    secret: () => secret,
    async createOrder({ amountPaise, currency }) {
      return { id: rules.gatewayId("order"), amount: amountPaise, currency };
    },
  };
}

function razorpay(settings) {
  const auth = `Basic ${Buffer.from(`${settings.keyId}:${settings.keySecret}`).toString("base64")}`;
  return {
    name: "razorpay",
    keyId: settings.keyId,
    secret: () => settings.keySecret,
    // POST /v1/orders: { amount (paise), currency, receipt } → { id: "order_…", … }
    async createOrder({ amountPaise, currency, receipt }) {
      const response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountPaise, currency, receipt }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Razorpay order failed with ${response.status}`);
      const order = await response.json();
      if (!rules.ORDER_ID.test(order?.id ?? "")) throw new Error("Razorpay answered without an order id");
      return { id: order.id, amount: order.amount, currency: order.currency };
    },
  };
}

let current = null;
/** The configured gateway, made once (PAYMENT_PROVIDER; the dummy by default) */
function gateway(env = process.env) {
  if (!current) {
    const settings = rules.providerSettings(env);
    current = settings.name === "razorpay" ? razorpay(settings) : dummy(settings, env.AUTH_SECRET);
  }
  return current;
}

module.exports = { gateway };
