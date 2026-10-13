// MySQL connection pool. Settings come from .env (see .env.example).
const mysql = require("mysql2/promise");

for (const key of ["DB_USER", "DB_PASSWORD", "DB_NAME"]) {
  if (process.env[key] === undefined) throw new Error(`Missing ${key} in .env (copy .env.example to get started)`);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  // DECIMAL columns (grams, kg) arrive as numbers instead of strings
  decimalNumbers: true,
});

module.exports = { pool };
