// Sends the sign-in code by SMS. The only code that talks to an SMS provider, so changing
// providers never touches the sign-in logic. Picked by SMS_PROVIDER:
//
//   off       (default) nothing is sent; the request-otp route answers 503
//   fake      tests only: writes { phone, code } to a file in SMS_FAKE_OUTBOX for the test to
//             read. Refused unless NODE_ENV=test and DB_NAME=justfit_test.
//   fast2sms  Fast2SMS over HTTPS with FAST2SMS_API_KEY (DLT route or OTP API, see below)
//
// Nothing here logs or returns the phone number, the code, the request body or the key. A
// failure becomes an SmsError carrying only the provider's numeric status code (or
// "timeout" / "network"), which is safe to log.
const fs = require("node:fs");
const path = require("node:path");

const FAST2SMS_DLT_URL = "https://www.fast2sms.com/dev/bulkV2";
const FAST2SMS_OTP_URL = "https://www.fast2sms.com/dev/otp/send";
const TIMEOUT_MS = 8000;

class SmsError extends Error {
  constructor(reason) {
    super(`SMS not sent (${reason})`);
    this.name = "SmsError";
    this.reason = String(reason).slice(0, 40);
  }
}

// The fake provider (tests): the newest code per number, as <outbox>/<phone>.json. A file
// named fail-<phone> in the outbox makes the next sends to that number fail, so tests can
// check provider failures.
function fakeProvider(env) {
  if (env.NODE_ENV !== "test" || env.DB_NAME !== "justfit_test") {
    throw new Error("SMS_PROVIDER=fake is only allowed in tests (NODE_ENV=test and DB_NAME=justfit_test)");
  }
  const outbox = env.SMS_FAKE_OUTBOX;
  if (!outbox || !path.isAbsolute(outbox) || !fs.existsSync(outbox)) throw new Error("SMS_FAKE_OUTBOX must be an existing absolute folder");
  return {
    kind: "fake",
    enabled: true,
    async sendOtp(phone, code) {
      if (fs.existsSync(path.join(outbox, `fail-${phone}`))) throw new SmsError("fake-failure");
      fs.writeFileSync(path.join(outbox, `${phone}.json`), JSON.stringify({ phone, code, at: Date.now() }), { mode: 0o600 });
    },
  };
}

// Fast2SMS. Two routes, both sending the code we generated (Fast2SMS's own verify is not used):
//   FAST2SMS_ROUTE=dlt  POST /dev/bulkV2 with the DLT sender id and template (message) id, the
//                       code as the template's one variable
//   FAST2SMS_ROUTE=otp  POST /dev/otp/send with the OTP template id and our code in "otp"
function fast2smsProvider(env, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const key = env.FAST2SMS_API_KEY;
  if (!key) throw new Error("SMS_PROVIDER=fast2sms needs FAST2SMS_API_KEY");
  const route = env.FAST2SMS_ROUTE ?? "dlt";
  let url, body;
  if (route === "dlt") {
    if (!/^[A-Z]{3,6}$/.test(env.FAST2SMS_SENDER_ID ?? "")) throw new Error("FAST2SMS_SENDER_ID must be the 3-6 letter DLT sender id");
    if (!/^[0-9]{1,30}$/.test(env.FAST2SMS_TEMPLATE_ID ?? "")) throw new Error("FAST2SMS_TEMPLATE_ID must be the numeric DLT message id");
    url = FAST2SMS_DLT_URL;
    body = (phone, code) => ({ route: "dlt", sender_id: env.FAST2SMS_SENDER_ID, message: env.FAST2SMS_TEMPLATE_ID, variables_values: code, numbers: phone });
  } else if (route === "otp") {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(env.FAST2SMS_OTP_ID ?? "")) throw new Error("FAST2SMS_OTP_ID must be the OTP template id");
    url = FAST2SMS_OTP_URL;
    body = (phone, code) => ({ mobile: phone, otp_id: env.FAST2SMS_OTP_ID, otp: code, otp_length: code.length, otp_expiry: 5 });
  } else {
    throw new Error('FAST2SMS_ROUTE must be "dlt" or "otp"');
  }
  return {
    kind: "fast2sms",
    enabled: true,
    async sendOtp(phone, code) {
      let response, result;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: key, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body(phone, code)),
          signal: AbortSignal.timeout(timeoutMs),
        });
        result = await response.json().catch(() => null);
      } catch (error) {
        throw new SmsError(error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network");
      }
      if (!response.ok || result?.return !== true) throw new SmsError(result?.status_code ?? response.status);
    },
  };
}

function createSmsProvider(env = process.env, options = {}) {
  const kind = env.SMS_PROVIDER || "off";
  if (kind === "off") return { kind, enabled: false, async sendOtp() { throw new SmsError("off"); } };
  if (kind === "fake") return fakeProvider(env);
  if (kind === "fast2sms") return fast2smsProvider(env, options);
  throw new Error('SMS_PROVIDER must be "off", "fake" or "fast2sms"');
}

module.exports = { createSmsProvider, SmsError };
