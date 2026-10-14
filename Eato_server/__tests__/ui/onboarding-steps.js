// Drives the setup steps in the real web UI from the personal step to the targets step,
// using only the screens' visible labels and placeholders (shared by the UI tests).
const NAV_TIMEOUT = 20000;
// Clerk development instances accept this code for +clerk_test addresses (no email is sent)
const CLERK_TEST_CODE = "424242";

const defaultAnswers = {
  fullName: "E2E Tester", phone: "9876543210", gender: "Female",
  goal: "Lose fat", heightCm: "170", weightKg: "60", activity: "Lightly active", activityHint: "exercise 1–3 days per week",
  diet: "Vegan", cuisine: "South Indian", dislikes: "okra",
  workoutFrequency: "3–4 days", workoutType: "Home", workoutTime: "Evening", mealsPerDay: "3",
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
  const goto = async (route, text) => { await page.navigate(`${baseUrl}${route}`); await expectText(text); await settle(); };
  const expectPath = async (route) => { await page.waitFor(`location.pathname === ${JSON.stringify(route)}`, NAV_TIMEOUT, `navigation to ${route}`); await settle(); };
  const input = (placeholder) => `input[placeholder=${JSON.stringify(placeholder)}]`;
  return { settle, expectText, expectNoText, goto, expectPath, input };
}

// Signs in through the real Log in screen (ending any session the browser still holds first)
// and waits until the app has routed the account to setup or home. The password only
// travels from the test's memory into the page's input; it is never logged.
async function signInAs(page, h, identity) {
  await h.goto("/sign-in", "Log in");
  if (await page.evaluate(`!!(window.Clerk && window.Clerk.session)`)) {
    await page.evaluate(`window.Clerk.signOut({ redirectUrl: "/sign-in" })`);
    await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "previous session ended");
    await h.goto("/sign-in", "Log in");
  }
  await page.setInput(h.input("Email address"), identity.emailAddress);
  await page.setInput(h.input("Password"), identity.password);
  await page.clickText("Log in");
  const outcome = await page.waitFor(
    `(() => { const t = document.body.innerText || ""; if (location.pathname.startsWith("/setup") || location.pathname === "/home") return "routed"; if (t.includes("Check your email")) return "code"; const alert = document.querySelector('[role="alert"]'); if (alert && alert.innerText.trim()) return "error:" + alert.innerText.trim().slice(0, 120); return ""; })()`,
    60000, "sign-in outcome",
  );
  if (outcome === "code") {
    await page.setInput('input[maxlength="6"]', CLERK_TEST_CODE);
    await page.waitFor(`location.pathname.startsWith("/setup") || location.pathname === "/home"`, 60000, "route after the emailed code");
  } else if (outcome.startsWith("error:")) {
    throw new Error(`sign-in screen showed an error: ${outcome.slice(6)}`);
  }
  await h.settle();
}

// From /setup/personal (already open) through to /setup/targets. Returns the shown date of birth.
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
  await page.setInput(h.input("98765 43210"), a.phone);
  // The email is the account's, shown read-only: nothing to type
  await page.clickText("Next");
  await h.expectPath("/setup/goal");

  await page.clickText(a.goal);
  await page.clickText("Next");
  await h.expectPath("/setup/body");

  await page.setInput(h.input("170"), a.heightCm);
  await page.setInput(h.input("70"), a.weightKg);
  await page.clickText("Select");
  await h.expectText("Extra active");
  await page.clickText(a.activity);
  await h.expectNoText("Extra active");
  await h.expectText(a.activityHint);
  await page.clickText("Next");
  await h.expectPath("/setup/food");

  await page.clickText(a.diet);
  await page.clickText(a.cuisine);
  await page.setInput(h.input("e.g. mushrooms, brinjal"), a.dislikes);
  await page.clickText("Next");
  await h.expectPath("/setup/lifestyle");

  await page.clickText(a.workoutFrequency);
  await page.clickText(a.workoutType);
  await page.clickText(a.workoutTime);
  await page.clickText(a.mealsPerDay);
  await page.clickText("Next");
  await h.expectPath("/setup/targets");
  await h.expectText("Estimated daily target");
  return { answers: a, dob };
}

module.exports = { defaultAnswers, dateOfBirth, helpers, signInAs, fillSetup, NAV_TIMEOUT, CLERK_TEST_CODE };
