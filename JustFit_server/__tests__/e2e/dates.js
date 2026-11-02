// The app's day for the e2e suites: the date in India, as the server checks it (macro/validate.js
// appToday), `offsetDays` from today. The UTC date is a day behind between 00:00 and 05:30 IST.
const { appToday } = require("../../macro/validate.js");

const DAY_MS = 24 * 60 * 60 * 1000;
const appDay = (offsetDays = 0) => {
  const today = appToday();
  return new Date(Date.parse(`${today}T00:00:00Z`) + offsetDays * DAY_MS).toISOString().slice(0, 10);
};

module.exports = { appDay };
