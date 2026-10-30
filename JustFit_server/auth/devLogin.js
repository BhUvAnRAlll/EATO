// A fixed sign-in code for one phone number, for development only, so a developer can sign in
// on a phone before an SMS provider is set up. Off unless both DEV_LOGIN_PHONE and
// DEV_LOGIN_CODE are set. When they are, the server starts only if NODE_ENV says development
// (on the development database `eato`) or test (on `eato_test`): anywhere else, production
// included, it refuses to start, so a copied .env can't open an account on a real server.
//
// It changes only what code is used and that no SMS is sent, for that one number. The code is
// still stored as a hash, checked in constant time, limited to 5 wrong tries, used once, and
// requested within the normal cooldown and hourly / daily limits (auth/service.js). Every other
// number goes through the configured SMS provider as before. The number and the code are never
// logged. Pure: no database and no network.
const { MOBILE } = require("./phone");

const ALLOWED = [
  { nodeEnv: "development", dbName: "eato" },
  { nodeEnv: "test", dbName: "eato_test" },
];

// A code anyone would try first: one digit repeated, or a run up or down (123456, 987654)
function weakCode(code) {
  const digits = [...code].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

// { phone, code } when the development code is on, null when it is off. Throws (a startup
// error, never the values) when it is set where it isn't allowed or set badly.
function devLoginConfig(env = process.env) {
  const phone = env.DEV_LOGIN_PHONE ?? "";
  const code = env.DEV_LOGIN_CODE ?? "";
  if (phone === "" && code === "") return null;
  if (!ALLOWED.some((a) => env.NODE_ENV === a.nodeEnv && env.DB_NAME === a.dbName)) {
    throw new Error("DEV_LOGIN_PHONE / DEV_LOGIN_CODE are only allowed with NODE_ENV=development on the eato database (or in tests); remove them");
  }
  if (!MOBILE.test(phone)) throw new Error("DEV_LOGIN_PHONE must be a 10-digit Indian mobile number");
  if (!/^[0-9]{6}$/.test(code)) throw new Error("DEV_LOGIN_CODE must be 6 digits");
  if (weakCode(code)) throw new Error("DEV_LOGIN_CODE is too easy to guess; pick 6 random digits");
  return { phone, code };
}

// Whether this request is for the development number
const isDevPhone = (devLogin, phone) => devLogin !== null && devLogin !== undefined && devLogin.phone === phone;

module.exports = { devLoginConfig, isDevPhone, weakCode };
