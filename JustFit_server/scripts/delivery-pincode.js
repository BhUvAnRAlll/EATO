// The pincodes justFit delivers to (delivery_pincodes). A member's address outside the list is
// saved but shown as "not delivering here yet", and checkout will refuse it.
//
//   npm run delivery-pincode -- list
//   npm run delivery-pincode -- add <pincode> [area name]
//   npm run delivery-pincode -- off <pincode>
//
// Runs against the database in JustFit_server/.env.
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { pool } = require("../database");
const rules = require("../addresses/rules");

const USAGE = "Usage: npm run delivery-pincode -- list | add <pincode> [area] | off <pincode>";

async function main() {
  const [command, code, ...areaWords] = process.argv.slice(2);
  if (command === "list") {
    const [rows] = await pool.query("SELECT pincode, area, active FROM delivery_pincodes ORDER BY pincode");
    if (rows.length === 0) console.log("No delivery pincodes yet.");
    for (const r of rows) console.log(`${r.pincode}  ${r.active ? "on " : "off"}  ${r.area ?? ""}`);
    return 0;
  }
  if (command !== "add" && command !== "off") {
    console.error(USAGE);
    return 1;
  }
  let pincode;
  try {
    pincode = rules.pincode(code);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (command === "off") {
    const [result] = await pool.query("UPDATE delivery_pincodes SET active = 0 WHERE pincode = ?", [pincode]);
    console.log(result.affectedRows ? `${pincode} is off: justFit no longer delivers there.` : `${pincode} isn't on the list.`);
    return 0;
  }
  const area = areaWords.join(" ").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  await pool.query(
    "INSERT INTO delivery_pincodes (pincode, area, active) VALUES (?, ?, 1) AS fresh ON DUPLICATE KEY UPDATE active = 1, area = COALESCE(fresh.area, delivery_pincodes.area)",
    [pincode, area],
  );
  console.log(`${pincode}${area ? ` (${area})` : ""} is on: justFit delivers there.`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => { console.error(`delivery-pincode failed: ${error.code ?? error.name}`); process.exitCode = 1; })
  .finally(() => pool.end());
