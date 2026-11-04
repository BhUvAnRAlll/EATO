// Sends the gym portal's SMS to members (reminders and wishes; see smsRules.js). Separate from
// the sign-in sender (auth/sms.js) but on the same SMS_PROVIDER:
//
//   off       nothing is sent; the portal says sending isn't switched on and falls back to the
//             phone's own SMS app
//   fake      tests only (NODE_ENV=test, DB_NAME=justfit_test): each message is appended to
//             <SMS_FAKE_OUTBOX>/gym-sms.jsonl. A file named fail-<phone> there makes sends to
//             that number fail.
//   fast2sms  Fast2SMS's DLT route with FAST2SMS_API_KEY and FAST2SMS_SENDER_ID, one registered
//             template per message: FAST2SMS_GYM_EXPIRY_ID, _EXPIRED_ID, _DUE_ID, _BIRTHDAY_ID.
//             Without all four, gym SMS stay off (sign-in codes are unaffected).
//
// Nothing here logs or returns a phone number, a message or the key; a failure is an SmsError
// with only the provider's status code (or "timeout" / "network").
const fs = require("node:fs");
const path = require("node:path");

const { SmsError } = require("../auth/sms");
const { KINDS } = require("./smsRules");

const FAST2SMS_DLT_URL = "https://www.fast2sms.com/dev/bulkV2";
const TIMEOUT_MS = 8000;
const off = (reason) => ({ kind: "off", enabled: false, reason, async send() { throw new SmsError("off"); } });

function createGymSmsSender(env = process.env, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const provider = env.SMS_PROVIDER || "off";
  if (provider === "fake") {
    if (env.NODE_ENV !== "test" || env.DB_NAME !== "justfit_test") return off("fake is for tests only");
    const outbox = env.SMS_FAKE_OUTBOX;
    if (!outbox || !path.isAbsolute(outbox) || !fs.existsSync(outbox)) return off("no fake outbox");
    return {
      kind: "fake",
      enabled: true,
      async send(phone, kind, values) {
        if (fs.existsSync(path.join(outbox, `fail-${phone}`))) throw new SmsError("fake-failure");
        fs.appendFileSync(path.join(outbox, "gym-sms.jsonl"), `${JSON.stringify({ phone, kind, values, at: Date.now() })}\n`, { mode: 0o600 });
      },
    };
  }
  if (provider !== "fast2sms") return off("SMS_PROVIDER is off");

  const templates = Object.fromEntries(KINDS.map((kind) => [kind, env[`FAST2SMS_GYM_${kind.toUpperCase()}_ID`] ?? ""]));
  if (!env.FAST2SMS_API_KEY || !/^[A-Z]{3,6}$/.test(env.FAST2SMS_SENDER_ID ?? "")) return off("Fast2SMS key or sender id missing");
  if (KINDS.some((kind) => !/^[0-9]{1,30}$/.test(templates[kind]))) return off("FAST2SMS_GYM_*_ID templates missing");
  return {
    kind: "fast2sms",
    enabled: true,
    async send(phone, kind, values) {
      let response, result;
      try {
        response = await fetchImpl(FAST2SMS_DLT_URL, {
          method: "POST",
          headers: { authorization: env.FAST2SMS_API_KEY, "content-type": "application/json", accept: "application/json" },
          // DLT variables are separated by "|", so a value may not contain one
          body: JSON.stringify({ route: "dlt", sender_id: env.FAST2SMS_SENDER_ID, message: templates[kind], variables_values: values.map((v) => String(v).replaceAll("|", "/")).join("|"), numbers: phone }),
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

module.exports = { createGymSmsSender };
