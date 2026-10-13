// Starts the real Express server (index.js) as a child process on the test port against
// the test database, and makes sure it is stopped again even if the run is interrupted.
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "..");

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
async function startTestServer(env) {
  const port = Number(env.PORT);
  if (!(await portFree(port))) throw new Error(`port ${port} is already in use; refusing to start a second server`);
  const child = spawn(process.execPath, [path.join(SERVER, "index.js")], {
    cwd: SERVER,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
      PORT: env.PORT, DB_HOST: env.DB_HOST, DB_PORT: env.DB_PORT, DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD,
      DB_NAME: env.DB_NAME, CLERK_SECRET_KEY: env.CLERK_SECRET_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  const keep = (chunk) => { for (const line of String(chunk).split("\n")) if (line.trim() && !/Warning|trace-warnings|Reparsing|eliminate this warning/.test(line)) logs.push(line); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 3000).unref();
  });
  // Never leave the child behind: on normal exit, Ctrl-C or a termination signal
  const onSignal = () => { child.kill("SIGTERM"); process.exit(130); };
  process.once("exit", () => { if (child.exitCode === null) child.kill("SIGKILL"); });
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\n${logs.slice(-5).join("\n")}`);
  }
  return { baseUrl, pid: child.pid, stop, logs };
}

module.exports = { startTestServer, portFree };
