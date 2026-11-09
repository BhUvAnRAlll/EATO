// Starts the real Express server (index.js) as a child process on the test port against
// the test database, and makes sure it is stopped again even if the run is interrupted.
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "..");

// The fake SMS outbox of the test server running in this process (one at a time), so the UI
// tests' sign-in helper can read the code the server "sent" (see latestCode below)
let currentOutbox = null;

// Sign-in limits for test servers: no cooldown and generous caps, because tests sign the same
// accounts in again and again. A test of the limits passes its own OTP_* values (they win).
const RELAXED_OTP = {
  OTP_COOLDOWN_SECONDS: "0", OTP_PER_HOUR: "1000", OTP_PER_DAY: "10000", OTP_DAILY_SMS_CAP: "100000",
  OTP_IP_REQUEST_LIMIT: "100000", OTP_IP_VERIFY_LIMIT: "100000",
  // The gym team's hourly change budget (30 in production): the staff suite spends more than that
  GYM_STAFF_CHANGES_PER_HOUR: "1000",
  GYM_PAUSE_REQUESTS_PER_HOUR: "1000",
  GYM_JOIN_REQUESTS_PER_HOUR: "1000",
  // Delivery addresses (60 an hour in production): the addresses suite saves more than that
  ADDRESS_CHANGES_PER_HOUR: "1000",
  // Reminder templates (30 in production): the templates suite adds 21 of its own in one test
  GYM_TEMPLATE_CHANGES_PER_HOUR: "1000",
  GYM_REQUESTS_PER_MINUTE: "1000",
  // Meal orders and cancels (20 an hour in production): the meals suite places more than that
  MEAL_ORDERS_PER_HOUR: "1000",
  MEAL_PAYMENTS_PER_HOUR: "1000",
};

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createConnection({ host: "127.0.0.1", port });
    probe.once("connect", () => { probe.destroy(); resolve(false); });
    probe.once("error", () => resolve(true));
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("test server did not become healthy in time");
}

// env: the validated .env.test values. Only these (plus PATH/HOME) reach the child, and
// index.js's own .env load never overrides a variable that is already set.
// Sign-in codes go to the fake SMS provider: a throwaway outbox folder per server, read with
// readCode(phone). AUTH_SECRET is random for each server unless .env.test pins one.
// options.sms: "fake" (default) or "off", for the test that checks phone sign-in switched off.
async function startTestServer(env, { sms = "fake" } = {}) {
  const port = Number(env.PORT);
  if (!(await portFree(port))) throw new Error(`port ${port} is already in use; refusing to start a second server`);
  const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-sms-"));
  currentOutbox = outbox;
  const child = spawn(process.execPath, [path.join(SERVER, "index.js")], {
    cwd: SERVER,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
      PORT: env.PORT, DB_HOST: env.DB_HOST, DB_PORT: env.DB_PORT, DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD,
      DB_NAME: env.DB_NAME,
      AUTH_SECRET: env.AUTH_SECRET || crypto.randomBytes(32).toString("base64url"),
      SMS_PROVIDER: sms === "off" ? "off" : "fake", SMS_FAKE_OUTBOX: outbox,
      ...RELAXED_OTP,
      // The development sign-in code is off on the test server unless a test passes it in (empty
      // values keep index.js's own .env load from turning it on): the UI suites sign gym staff in
      // through the fake SMS outbox, and a team number would take the dev code instead
      DEV_LOGIN_PHONE: "", DEV_LOGIN_CODE: "",
      // The AI tests pass their fake provider and limits; the phone sign-in tests their limits and
      // the development sign-in code
      ...Object.fromEntries(Object.entries(env).filter(([key]) => /^(AI_|OTP_|DEV_LOGIN_)/.test(key))),
      // The body scan test points the scan route at a local fake Forma server
      ...(env.FORMA_SCAN_URL ? { FORMA_SCAN_URL: env.FORMA_SCAN_URL } : {}),
      // Program covers go to the test's own throwaway folder, never the repo's uploads/
      ...(env.COVER_DIR ? { COVER_DIR: env.COVER_DIR } : {}),
      // and so do gym member photos
      ...(env.MEMBER_PHOTO_DIR ? { MEMBER_PHOTO_DIR: env.MEMBER_PHOTO_DIR } : {}),
      // and catalogue item images
      ...(env.CATALOG_IMAGE_DIR ? { CATALOG_IMAGE_DIR: env.CATALOG_IMAGE_DIR } : {}),
      // and payment bills
      ...(env.PAYMENT_RECEIPT_DIR ? { PAYMENT_RECEIPT_DIR: env.PAYMENT_RECEIPT_DIR } : {}),
      ...(env.GYM_LOGO_DIR ? { GYM_LOGO_DIR: env.GYM_LOGO_DIR } : {}),
      ...(env.GYM_PHOTO_DIR ? { GYM_PHOTO_DIR: env.GYM_PHOTO_DIR } : {}),
      ...(env.TRAINER_PHOTO_DIR ? { TRAINER_PHOTO_DIR: env.TRAINER_PHOTO_DIR } : {}),
      ...(env.GYM_DOCUMENT_DIR ? { GYM_DOCUMENT_DIR: env.GYM_DOCUMENT_DIR } : {}),
      ...(env.EXPENSE_BILL_DIR ? { EXPENSE_BILL_DIR: env.EXPENSE_BILL_DIR } : {}),
      ...(env.MEAL_PHOTO_DIR ? { MEAL_PHOTO_DIR: env.MEAL_PHOTO_DIR } : {}),
      // The YouTube test points the video loader at a local fake API with a test key
      ...(env.YOUTUBE_API_URL ? { YOUTUBE_API_URL: env.YOUTUBE_API_URL, YOUTUBE_API_KEY: env.YOUTUBE_API_KEY } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  const keep = (chunk) => { for (const line of String(chunk).split("\n")) if (line.trim() && !/Warning|trace-warnings|Reparsing|eliminate this warning/.test(line)) logs.push(line); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const removeOutbox = () => {
    if (currentOutbox === outbox) currentOutbox = null;
    fs.rmSync(outbox, { recursive: true, force: true });
  };
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { removeOutbox(); return resolve(); }
    child.once("exit", () => { removeOutbox(); resolve(); });
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 3000).unref();
  });
  // Never leave the child behind: on normal exit, Ctrl-C or a termination signal
  const onSignal = () => { child.kill("SIGTERM"); process.exit(130); };
  process.once("exit", () => { if (child.exitCode === null) child.kill("SIGKILL"); removeOutbox(); });
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\n${logs.slice(-5).join("\n")}`);
  }
  // The newest code the fake provider "sent" to a 10-digit number (null if none)
  const readCode = (phone) => {
    const file = path.join(outbox, `${phone}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).code : null;
  };
  // Makes sends to a number fail (true) or work again (false), to test provider failures
  const failSmsTo = (phone, fail = true) => {
    const marker = path.join(outbox, `fail-${phone}`);
    if (fail) fs.writeFileSync(marker, "");
    else fs.rmSync(marker, { force: true });
  };
  return { baseUrl, pid: child.pid, stop, logs, readCode, failSmsTo, outbox };
}

// The newest code the running test server "sent" to a 10-digit number, or null
function latestCode(phone) {
  if (!currentOutbox) return null;
  const file = path.join(currentOutbox, `${phone}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).code : null;
}

module.exports = { startTestServer, portFree, latestCode };
