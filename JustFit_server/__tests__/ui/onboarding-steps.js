// Drives the setup steps in the real web UI from the personal step to the targets step,
// using only the screens' visible labels and placeholders (shared by the UI tests).
const { latestCode } = require("../e2e/server.js");

const NAV_TIMEOUT = 20000;
// Where the web build keeps the session token (JustFit_client/src/lib/tokenStorage.ts)
const SESSION_KEY = "justfit.session";

const defaultAnswers = {
  fullName: "E2E Tester", phone: "9876543210", gender: "Female",
  goal: "Lose fat", heightCm: "170", weightKg: "60", activity: "Lightly active", activityHint: "exercise 1–3 days per week",
  diet: "Vegan", cuisine: "South Indian", dislikes: "okra",
  mealsPerDay: "3",
};

// What the web date field takes and what the personal step then displays for a given age
function dateOfBirth(age) {
  const birth = new Date(); birth.setFullYear(birth.getFullYear() - age);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    input: `${birth.getFullYear()}-${pad(birth.getMonth() + 1)}-${pad(birth.getDate())}`,
    shown: birth.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
  };
}

function helpers(page, baseUrl) {
  const settle = () => new Promise((r) => setTimeout(r, 1000));
  const expectText = (text) => page.waitFor(`(document.body.innerText || "").includes(${JSON.stringify(text)})`, NAV_TIMEOUT, `text "${text}"`);
  const expectNoText = (text) => page.waitFor(`!(document.body.innerText || "").includes(${JSON.stringify(text)})`, NAV_TIMEOUT, `text "${text}" gone`);
  // Loads a route. A load Chrome reports as aborted (an in-app navigation from the previous
  // step was still landing) is tried again, at most three times in all.
  const goto = async (route, text) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await page.navigate(`${baseUrl}${route}`);
      if (!result?.errorText) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await expectText(text);
    await settle();
  };
  const expectPath = async (route) => { await page.waitFor(`location.pathname === ${JSON.stringify(route)}`, NAV_TIMEOUT, `navigation to ${route}`); await settle(); };
  const input = (placeholder) => `input[placeholder=${JSON.stringify(placeholder)}]`;
  return { settle, expectText, expectNoText, goto, expectPath, input };
}

// Whether the page holds a signed-in session, and ending it there (as a closed tab would leave it)
const hasSession = (page) => page.evaluate(`!!localStorage.getItem(${JSON.stringify(SESSION_KEY)})`);
const forgetSession = (page) => page.evaluate(`localStorage.removeItem(${JSON.stringify(SESSION_KEY)})`);
// The session token the page holds (for in-page API calls), or null. Never logged.
const sessionTokenExpression = `localStorage.getItem(${JSON.stringify(SESSION_KEY)})`;

// The phone field of the Log in / Sign up screens, found fresh each time
const PHONE_INPUT = 'input[aria-label="Mobile number"]';

// Waits for the code the test server's fake SMS provider "sent" to this number (the newest one)
async function codeFor(phone, after = null) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const code = latestCode(phone);
    if (code && code !== after) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no sign-in code reached the fake SMS outbox");
}

// Types the identity's mobile number into the open Log in / Sign up screen and asks for a code.
// Returns once the code sheet is open (or the screen shows an error).
async function fillSignInForm(page, h, identity) {
  await page.waitFor(`!!document.querySelector(${JSON.stringify(PHONE_INPUT)})`, 60000, "the mobile number field");
  await page.setInput(PHONE_INPUT, identity.phone);
  const typed = await page.evaluate(`(document.querySelector(${JSON.stringify(PHONE_INPUT)}) || {}).value || ""`);
  if (typed.replace(/\D/g, "") !== identity.phone) throw new Error("the mobile number field didn't keep the typed number");
}

// Signs in through the real Log in screen (ending any session the browser still holds first):
// the number, "Send code", the code from the fake SMS outbox, and waits until the app has
// routed the account to its place (setup, home or a dashboard).
async function signInAs(page, h, identity) {
  // A signed-in account opening Log in is sent on to its own area, so the session the page
  // holds is forgotten first (a blank page has no storage to ask: nothing to forget there)
  if (await hasSession(page).catch(() => false)) await forgetSession(page);
  await h.goto("/sign-in", "Send code");
  const before = latestCode(identity.phone);
  await fillSignInForm(page, h, identity);
  await page.clickText("Send code");
  const outcome = await page.waitFor(
    `(() => { const t = document.body.innerText || ""; if (t.includes("Check your messages")) return "code"; const alert = document.querySelector('[role="alert"]'); if (alert && alert.innerText.trim()) return "error:" + alert.innerText.trim().slice(0, 120); return ""; })()`,
    60000, "the code sheet",
  );
  if (outcome.startsWith("error:")) throw new Error(`sign-in screen showed an error: ${outcome.slice(6)}`);
  await page.setInput('input[maxlength="6"]', await codeFor(identity.phone, before));
  await page.waitFor(`["/home", "/admin", "/gym"].includes(location.pathname) || location.pathname.startsWith("/setup")`, 60000, "route after the code");
  await h.settle();
}

// From /setup/personal (already open) through to /setup/targets, as a member does it since
// 2026-11-10: the personal details and Finish (setup is that one screen), Home's "Finish your
// profile" card, then the goal and activity. Leaves the targets screen open, so the caller's
// "Finish" saves the targets and returns to Home. The food answers are no longer part of it
// (`foodOverHttp` saves them through Profile's food route when a suite needs them).
// Returns the shown date of birth.
async function fillSetup(page, baseUrl, overrides = {}, age = 30) {
  const a = { ...defaultAnswers, ...overrides };
  const h = helpers(page, baseUrl);
  const dob = dateOfBirth(age);

  await h.expectText("Let's get to know you");
  await page.setInput(h.input("Your full name"), a.fullName);
  await page.clickText("Select your birthday");
  await h.expectText("Cancel");
  await page.setInput("[aria-modal] input", dob.input);
  await page.clickText("Done");
  await h.expectText(dob.shown);
  await h.expectNoText("Done");
  await page.clickText("Select");
  await h.expectText("Prefer not to say");
  await page.clickText(a.gender);
  await h.expectNoText("Prefer not to say");
  await page.setInput(h.input("170"), a.heightCm);
  await page.setInput(h.input("70"), a.weightKg);
  await page.clickText("Finish");
  await h.expectPath("/home");

  // No targets yet: Home offers the goal and activity (the AI Coach intake sets them too). An
  // account that already has targets (setup opened again) goes through /goals instead
  await page.waitFor(`(document.body.innerText || "").includes("Finish your profile") || (document.body.innerText || "").includes("Today's Macros")`, NAV_TIMEOUT, "Home's first card");
  if (await page.hasText("Finish your profile")) await page.clickText("Add goal & activity");
  else await h.goto("/goals?from=home", "What's your goal?");
  await h.expectPath("/setup/goal");
  await page.clickText(a.goal);
  await page.clickText("Next");
  await h.expectPath("/setup/activity");

  // The edit opens on the saved activity level, if there is one (setup run again)
  await h.expectText("Activity level");
  await new Promise((r) => setTimeout(r, 800));
  if (!(await page.hasText(a.activityHint))) {
    await page.clickText("Select");
    await h.expectText("Extra active");
    await page.clickText(a.activity);
    await h.expectNoText("Extra active");
  }
  await h.expectText(a.activityHint);
  await page.clickText("Next");
  await h.expectPath("/setup/targets");
  await h.expectText("Estimated daily target");
  return { answers: a, dob };
}

module.exports = { defaultAnswers, dateOfBirth, helpers, signInAs, fillSignInForm, codeFor, hasSession, forgetSession, sessionTokenExpression, fillSetup, NAV_TIMEOUT, SESSION_KEY, PHONE_INPUT };
