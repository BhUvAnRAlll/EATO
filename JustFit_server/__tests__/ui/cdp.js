// Minimal Chrome DevTools Protocol client on Node's built-in WebSocket: launches a
// headless Chrome with its own throwaway profile, attaches to one page, and always
// kills the browser and deletes the profile again. No packages involved.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// How long one page evaluation (promise included) or one mouse event may take before it fails
// instead of hanging: a promise that never settles, or Chrome dropping its reply to an input
// event sent while the page navigates, would otherwise wait forever. This is per command, not
// per test. JUSTFIT_CDP_TIMEOUT_MS sets both; JUSTFIT_CDP_EVALUATE_TIMEOUT_MS overrides evaluations.
const COMMAND_TIMEOUT_MS = Number(process.env.JUSTFIT_CDP_TIMEOUT_MS) || 60000;
const EVALUATE_TIMEOUT_MS = Number(process.env.JUSTFIT_CDP_EVALUATE_TIMEOUT_MS) || COMMAND_TIMEOUT_MS;

async function launchChrome() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-ui-chrome-"));
  const child = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--window-size=430,932", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: "ignore" });

  const exited = () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once("exit", resolve); });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited(), new Promise((r) => setTimeout(r, 3000))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await Promise.race([exited(), new Promise((r) => setTimeout(r, 3000))]); }
    }
    // Chrome's helper processes release the profile shortly after the main process dies
    for (let attempt = 0; attempt < 20 && fs.existsSync(profile); attempt++) {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* still in use */ }
      if (fs.existsSync(profile)) await new Promise((r) => setTimeout(r, 250));
    }
  };
  process.once("exit", () => { if (child.exitCode === null) child.kill("SIGKILL"); fs.rmSync(profile, { recursive: true, force: true }); });
  const onSignal = () => { child.kill("SIGKILL"); fs.rmSync(profile, { recursive: true, force: true }); process.exit(130); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  // Chrome writes the chosen port to DevToolsActivePort inside the profile. On an 8 GB Mac with
  // Expo web bundling at the same time this takes well over 15 s (9 s on an idle machine).
  const portFile = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + (Number(process.env.JUSTFIT_CHROME_START_TIMEOUT_MS) || 60000);
  let port = null;
  while (Date.now() < deadline && !port) {
    if (fs.existsSync(portFile)) { const first = fs.readFileSync(portFile, "utf8").split("\n")[0]; if (/^\d+$/.test(first)) port = Number(first); }
    if (!port) await new Promise((r) => setTimeout(r, 200));
  }
  if (!port) { await close(); throw new Error("Chrome did not expose a DevTools port"); }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  return { profile, port, browserWsUrl: version.webSocketDebuggerUrl, version: version.Browser, close };
}

// One connection to the browser endpoint; commands can be scoped to a page session
function connect(browserWsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(browserWsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener("open", () => resolve(client));
    ws.addEventListener("error", (e) => reject(new Error("CDP connection failed: " + (e.message ?? "error"))));
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: fail } = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? fail(new Error(`${msg.error.message}`)) : ok(msg.result);
      } else if (msg.method) {
        for (const l of listeners) l(msg);
      }
    });
    const client = {
      // timeoutMs (optional): give up on the reply after this long. The command is dropped from
      // `pending`, so a late reply is ignored, and the timer is cleared when a reply arrives.
      send(method, params = {}, sessionId, { timeoutMs } = {}) {
        const id = nextId++;
        return new Promise((ok, fail) => {
          let timer = null;
          const settle = (fn) => (value) => { if (timer) clearTimeout(timer); fn(value); };
          pending.set(id, { resolve: settle(ok), reject: settle(fail) });
          if (timeoutMs) {
            timer = setTimeout(() => {
              if (!pending.delete(id)) return;
              fail(new Error(`CDP ${method} timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            timer.unref(); // never keeps the test process alive on its own
          }
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      },
      on(listener) { listeners.push(listener); },
      close() { ws.close(); },
    };
  });
}

// A fresh page with Page, Runtime and Network events enabled
async function openPage(client, url = "about:blank") {
  const { targetId } = await client.send("Target.createTarget", { url });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page", "Runtime", "Network", "Inspector"]) await client.send(`${domain}.enable`, {}, sessionId);
  await client.send("Target.setDiscoverTargets", { discover: true }); // Target.targetCrashed carries the status (oom, killed)
  const requests = [];
  // The page's last few uncaught errors, and whether its renderer died: a tab that crashed (out of
  // memory, most often on this 8 GB Mac) answers nothing, so every wait would otherwise sit out
  // its whole timeout and report a blank page. Found on 2026-11-07, when a full reload in the
  // gym staff suite died that way twice and the failure read as a timeout with no evidence.
  const pageErrors = [];
  // Every alert / confirm / "leave this page?" the page opens, accepted at once: a dialog blocks
  // the page's JavaScript until it is answered, so a run would otherwise freeze on it (the gym
  // staff suite did, on a "coming soon" alert the menu's backdrop click landed on, 2026-11-07)
  const dialogs = [];
  let crashed = null;
  client.on((msg) => {
    if (msg.sessionId === sessionId && msg.method === "Page.javascriptDialogOpening") {
      dialogs.push(`${msg.params.type} "${String(msg.params.message).replace(/\s+/g, " ").slice(0, 160)}"`);
      client.send("Page.handleJavaScriptDialog", { accept: true }, sessionId).catch(() => {});
    }
    if (msg.sessionId === sessionId && msg.method === "Network.requestWillBeSent") requests.push(msg.params.request.url);
    if (msg.sessionId === sessionId && msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      pageErrors.push((d.exception && d.exception.description) || d.text || "exception");
      if (pageErrors.length > 5) pageErrors.shift();
    }
    if (msg.sessionId === sessionId && msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      pageErrors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300)}`);
      if (pageErrors.length > 5) pageErrors.shift();
    }
    if (msg.sessionId === sessionId && msg.method === "Inspector.targetCrashed") crashed ??= "the page's renderer crashed";
    if (msg.method === "Target.targetCrashed" && msg.params.targetId === targetId) crashed ??= `the page's renderer crashed (${msg.params.status}, code ${msg.params.errorCode})`;
    if (msg.sessionId === sessionId && msg.method === "Inspector.detached") crashed ??= `the page was detached (${msg.params.reason})`;
  });
  const crashError = () => new Error(`${crashed}${pageErrors.length > 0 ? `; last page errors: ${pageErrors.map((e) => e.split("\n")[0]).join(" | ")}` : ""}`);
  const evaluate = async (expression) => {
    if (crashed) throw crashError();
    const { result, exceptionDetails } = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId, { timeoutMs: EVALUATE_TIMEOUT_MS });
    if (exceptionDetails) throw new Error("evaluate failed: " + (exceptionDetails.text ?? "exception"));
    return result.value;
  };
  // Real pointer events at an element's centre, so react-native-web Pressables respond as they would to a user
  const clickAt = async (x, y) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await client.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, sessionId, { timeoutMs: COMMAND_TIMEOUT_MS });
    }
  };
  // Clicks the nth leaf element whose visible text is exactly `text` (labels, chips, option cards, buttons)
  const clickText = async (text, nth = 0) => {
    // Only rendered elements count (a navigation stack keeps previous screens mounted but hidden),
    // and the centre must hit-test to the element itself, so nothing covered by a sheet is clicked
    const locate = () => evaluate(`(() => {
      const want = ${JSON.stringify(text)};
      const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === want && e.getClientRects().length > 0);
      const el = els[${nth}]; if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, count: els.length, hittable: !!hit && (hit === el || el.contains(hit)) };
    })()`);
    // Wait until the element exists and has stopped moving (images and fonts settle layout)
    let found = null, previous = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      found = await locate();
      if (found && found.hittable && previous && Math.abs(found.x - previous.x) < 1 && Math.abs(found.y - previous.y) < 1) break;
      previous = found;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!found) throw new Error(`no rendered element with text "${text}"`);
    if (!found.hittable) throw new Error(`element with text "${text}" is covered by something else`);
    await clickAt(found.x, found.y);
    return found.count;
  };
  // Clicks the rendered element whose accessibility label is exactly `label` (icon-only buttons,
  // such as the setup screens' back chevron, have no text to click)
  const clickLabel = async (label) => {
    const locate = () => evaluate(`(() => {
      const els = [...document.querySelectorAll('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']')].filter((e) => e.getClientRects().length > 0);
      const el = els[0]; if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const own = (px, py) => { const hit = document.elementFromPoint(px, py); return !!hit && (hit === el || el.contains(hit)); };
      let x = r.left + r.width / 2, y = r.top + r.height / 2;
      // The centre may be covered by something drawn on top (a side menu's backdrop fills the
      // screen under the menu panel): then any visible point of the element itself will do
      if (!own(x, y)) {
        const vw = window.innerWidth, vh = window.innerHeight;
        outer: for (const fx of [0.96, 0.04, 0.85, 0.15, 0.7, 0.3]) for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) {
          const px = r.left + r.width * fx, py = r.top + r.height * fy;
          if (px < 1 || py < 1 || px > vw - 1 || py > vh - 1) continue;
          if (own(px, py)) { x = px; y = py; break outer; }
        }
      }
      return { x, y, hittable: own(x, y) };
    })()`);
    let found = null;
    for (let attempt = 0; attempt < 40 && !(found && found.hittable); attempt++) {
      found = await locate();
      if (!(found && found.hittable)) await new Promise((r) => setTimeout(r, 150));
    }
    if (!found) throw new Error(`no rendered element labelled "${label}"`);
    if (!found.hittable) throw new Error(`element labelled "${label}" is covered by something else`);
    await clickAt(found.x, found.y);
  };
  // Types into an <input> the way React sees it: native value setter plus an input event
  const setInput = async (selector, value) => {
    const ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length > 0).pop(); if (!el) return false;
      el.scrollIntoView({ block: "center" }); el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true })); return true;
    })()`);
    if (!ok) throw new Error(`no input matching ${selector}`);
  };
  const inputValue = (selector) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length > 0).pop(); return el ? el.value : null; })()`);
  const hasText = (text) => evaluate(`(document.body && document.body.innerText || "").includes(${JSON.stringify(text)})`);
  const path = () => evaluate("location.pathname");
  return {
    sessionId, targetId, requests, pageErrors, dialogs,
    navigate: (to) => client.send("Page.navigate", { url: to }, sessionId),
    evaluate, clickAt, clickText, clickLabel, setInput, inputValue, hasText, path,
    // Polls until the predicate (run in the page) is truthy; a crashed page fails at once
    async waitFor(expression, timeoutMs, label = expression) {
      const deadline = Date.now() + timeoutMs;
      let last, lastError = null;
      while (Date.now() < deadline) {
        if (crashed) throw new Error(`${crashError().message}, while waiting for: ${label}`);
        try { last = await evaluate(expression); lastError = null; if (last) return last; } catch (error) { lastError = error; /* page may be mid-navigation */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      // Say why the page never answered: a stuck page (every evaluation timing out) reads very
      // differently from a page that answered but never showed the text
      const why = lastError ? `; the last evaluation failed: ${lastError.message.split("\n")[0]}` : "";
      const errors = pageErrors.length > 0 ? `; last page errors: ${pageErrors.map((e) => e.split("\n")[0]).join(" | ")}` : "";
      const opened = dialogs.length > 0 ? `; dialogs the page opened (accepted): ${dialogs.slice(-3).join(" | ")}` : "";
      throw new Error(`timed out waiting for: ${label}${why}${errors}${opened}`);
    },
    async screenshot(filePath) {
      const { data } = await client.send("Page.captureScreenshot", { format: "png" }, sessionId);
      fs.writeFileSync(filePath, Buffer.from(data, "base64"));
      return filePath;
    },
    bodyText: () => evaluate("document.body ? document.body.innerText : ''"),
  };
}

module.exports = { launchChrome, connect, openPage, CHROME };
