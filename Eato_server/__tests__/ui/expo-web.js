// Starts the Expo dev server for the web build of the client on a chosen port, with the
// Express base URL pinned to the isolated test server, and stops it again afterwards.
const { spawn } = require("node:child_process");
const path = require("node:path");

const CLIENT = path.join(__dirname, "..", "..", "..", "Eato_client");
const EXPO = path.join(CLIENT, "node_modules", ".bin", "expo");

async function startExpoWeb({ port, apiUrl, timeoutMs = 240000 }) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(apiUrl) || apiUrl.endsWith(":4000")) {
    throw new Error("refusing to start: apiUrl must be a local test server and never port 4000");
  }
  const child = spawn(EXPO, ["start", "--web", "--port", String(port)], {
    cwd: CLIENT,
    detached: true, // own process group, so Metro and friends go down with it
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, CI: "1", BROWSER: "none", EXPO_NO_TELEMETRY: "1",
      EXPO_PUBLIC_API_URL: apiUrl, // inlined into the web bundle; takes precedence over .env
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  const keep = (chunk) => { for (const line of String(chunk).split("\n")) if (line.trim()) logs.push(line.replace(/\x1b\[[0-9;]*m/g, "")); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const gone = () => child.exitCode !== null || child.signalCode !== null;
  const exited = () => new Promise((resolve) => { if (gone()) return resolve(); child.once("exit", resolve); });
  const killGroup = (signal) => { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } } };
  const stop = async () => {
    if (gone()) return;
    killGroup("SIGTERM");
    await Promise.race([exited(), new Promise((r) => setTimeout(r, 5000))]);
    if (!gone()) { killGroup("SIGKILL"); await Promise.race([exited(), new Promise((r) => setTimeout(r, 5000))]); }
    killGroup("SIGKILL"); // any straggler in the group (Metro workers)
  };
  process.once("exit", () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } });
  const onSignal = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } process.exit(130); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const baseUrl = `http://localhost:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) { throw new Error(`expo exited early\n${logs.slice(-8).join("\n")}`); }
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok && (await response.text()).includes("<html")) return { baseUrl, pid: child.pid, stop, logs };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stop();
  throw new Error(`expo web did not serve a page in time\n${logs.slice(-8).join("\n")}`);
}

module.exports = { startExpoWeb };
