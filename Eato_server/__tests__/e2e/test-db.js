// The isolated test database for the e2e suite. Everything here refuses to touch
// anything but the `eato_test` schema through the `eato_test` account, and rebuilds
// that schema from schema.sql so every run starts from a known, empty state.
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const SERVER = path.join(__dirname, "..", "..");
const ENV_TEST = path.join(SERVER, ".env.test");
const SCHEMA = path.join(SERVER, "schema.sql");

// Tables the profile flow writes, in an order that satisfies foreign keys when deleting
const PROFILE_TABLES = ["nutrition_targets", "body_composition_reports", "profiles", "users"];

// Reads .env.test and refuses anything that could point at the real application database
function loadTestEnv() {
  if (!fs.existsSync(ENV_TEST)) return { ok: false, reason: "Eato_server/.env.test is missing" };
  const env = {};
  for (const line of fs.readFileSync(ENV_TEST, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  for (const key of ["PORT", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "CLERK_SECRET_KEY"]) {
    if (!env[key]) return { ok: false, reason: `${key} is missing from .env.test` };
  }
  if (env.DB_NAME !== "eato_test") return { ok: false, reason: "DB_NAME must be exactly eato_test" };
  if (env.DB_USER !== "eato_test") return { ok: false, reason: "DB_USER must be exactly eato_test" };
  if (env.PORT === "4000") return { ok: false, reason: "PORT must not be the development server's port" };
  return { ok: true, env };
}

async function connect(env) {
  const connection = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
    decimalNumbers: true,
  });
  // Fail closed: the server must have put us exactly where .env.test says
  const [[who]] = await connection.query("SELECT CURRENT_USER() AS cu, DATABASE() AS db");
  if (!who.cu.startsWith("eato_test@") || who.db !== "eato_test") {
    await connection.end();
    throw new Error(`refusing to run: connected as ${who.cu} to ${who.db}`);
  }
  return connection;
}

// schema.sql without its CREATE DATABASE / USE lines and comments, one statement per entry
function schemaStatements() {
  const text = fs.readFileSync(SCHEMA, "utf8").split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
  return text.split(";").map((s) => s.trim()).filter((s) => s && !/^(CREATE DATABASE|USE)\b/i.test(s));
}

// Drops every table in eato_test and recreates them from schema.sql
async function resetSchema(connection) {
  const [rows] = await connection.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const { t } of rows) await connection.query("DROP TABLE IF EXISTS `" + t + "`");
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  for (const statement of schemaStatements()) await connection.query(statement);
  const [after] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  return after[0].n;
}

async function rowCounts(connection, tables = PROFILE_TABLES) {
  const counts = {};
  for (const table of tables) {
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM `" + table + "`");
    counts[table] = n;
  }
  return counts;
}

async function rowsForUser(connection, userId) {
  const counts = {};
  for (const table of PROFILE_TABLES) {
    const column = table === "users" ? "id" : "user_id";
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM `" + table + "` WHERE `" + column + "` = ?", [userId]);
    counts[table] = n;
  }
  return counts;
}

// Removes everything the profile flow wrote for these users (test account's own DELETE grant)
async function deleteUsers(connection, userIds) {
  if (userIds.length === 0) return;
  for (const table of PROFILE_TABLES) {
    const column = table === "users" ? "id" : "user_id";
    await connection.query("DELETE FROM `" + table + "` WHERE `" + column + "` IN (?)", [userIds]);
  }
}

module.exports = { PROFILE_TABLES, loadTestEnv, connect, schemaStatements, resetSchema, rowCounts, rowsForUser, deleteUsers };
