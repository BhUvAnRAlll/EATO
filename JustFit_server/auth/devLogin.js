// A fixed sign-in code for a few phone numbers, for development only, so developers can sign in
// on a phone before an SMS provider is set up. DEV_LOGIN_PHONE is one number or a short
// comma-separated list (at most 5); they share DEV_LOGIN_CODE. Off unless both DEV_LOGIN_PHONE and
// DEV_LOGIN_CODE are set. When they are, the server starts only if NODE_ENV says development
// (on the development database `justfit`) or test (on `justfit_test`): anywhere else, production
// included, it refuses to start, so a copied .env can't open an account on a real server.
//
// It changes only what code is used and that no SMS is sent, for those numbers. The code is
// still stored as a hash, checked in constant time, limited to 5 wrong tries, used once, and
// requested within the normal cooldown and hourly / daily limits (auth/service.js). Every other
// number goes through the configured SMS provider as before. The number and the code are never
// logged. Pure: no database and no network.
const { MOBILE } = require("./phone");

const ALLOWED = [
  { nodeEnv: "development", dbName: "justfit" },
  { nodeEnv: "test", dbName: "justfit_test" },
];

// A code anyone would try first: one digit repeated, or a run up or down (123456, 987654)
function weakCode(code) {
  const digits = [...code].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

const MAX_PHONES = 5;

// { phones, code } when the development code is on, null when it is off. Throws (a startup
// error, never the values) when it is set where it isn't allowed or set badly.
function devLoginConfig(env = process.env) {
  const phone = env.DEV_LOGIN_PHONE ?? "";
  const code = env.DEV_LOGIN_CODE ?? "";
  if (phone === "" && code === "") return null;
  if (!ALLOWED.some((a) => env.NODE_ENV === a.nodeEnv && env.DB_NAME === a.dbName)) {
    throw new Error("DEV_LOGIN_PHONE / DEV_LOGIN_CODE are only allowed with NODE_ENV=development on the justfit database (or in tests); remove them");
  }
  const phones = [...new Set(phone.split(",").map((p) => p.trim()))];
  if (phones.length > MAX_PHONES) throw new Error(`DEV_LOGIN_PHONE takes at most ${MAX_PHONES} numbers`);
  if (!phones.every((p) => MOBILE.test(p))) throw new Error("DEV_LOGIN_PHONE must be 10-digit Indian mobile numbers, separated by commas");
  if (!/^[0-9]{6}$/.test(code)) throw new Error("DEV_LOGIN_CODE must be 6 digits");
  if (weakCode(code)) throw new Error("DEV_LOGIN_CODE is too easy to guess; pick 6 random digits");
  return { phones, code };
}

// Whether this request is for one of the development numbers
const isDevPhone = (devLogin, phone) => devLogin !== null && devLogin !== undefined && devLogin.phones.includes(phone);

module.exports = { devLoginConfig, isDevPhone, weakCode };
