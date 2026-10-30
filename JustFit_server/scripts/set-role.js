// Gives an account a role ("user" or "admin"). The only way to make an admin: the app can't change its own role, and new accounts are always "user".
//
//   npm run set-role -- <phone> <user|admin>
//
// The person signs in with that phone number first (that creates the account); the new role
// counts on their next request, because roles are read from the database every time.
// Runs against the database in JustFit_server/.env.
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { pool } = require("../database");
const { normalizePhone } = require("../auth/phone");
const { ROLES } = require("../auth");

async function main() {
  const [phoneArg, role] = process.argv.slice(2);
  if (!phoneArg || !ROLES.includes(role)) {
    console.error(`Usage: npm run set-role -- <phone> <${ROLES.join("|")}>`);
    return 1;
  }
  let phone;
  try {
    phone = normalizePhone(phoneArg);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const [[user]] = await pool.query("SELECT id, role FROM users WHERE verified_phone = ?", [phone]);
  const shown = `+91 ••••• ${phone.slice(-5)}`;
  if (!user) {
    console.error(`No account has signed in with ${shown} yet. Ask them to sign in once, then run this again.`);
    return 1;
  }
  if (user.role === role) {
    console.log(`${shown} is already "${role}" (${user.id}).`);
    return 0;
  }
  await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, user.id]);
  console.log(`${shown} is now "${role}" (${user.id}), was "${user.role}". It applies on their next request.`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => { console.error(`set-role failed: ${error.code ?? error.name}`); process.exitCode = 1; })
  .finally(() => pool.end());
