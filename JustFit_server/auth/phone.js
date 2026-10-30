// Indian mobile numbers for phone sign-in. The app sends what the person typed; the server
// keeps the 10 digits (+91 implied), which is how users.phone and otp_challenges.phone store
// them, and shows them back as +91XXXXXXXXXX. Pure: no database.
const { ValidationError } = require("../profile");

const MOBILE = /^[6-9][0-9]{9}$/; // Indian mobile numbers start with 6, 7, 8 or 9
const INVALID = "Enter a valid 10-digit mobile number.";

// "98765 43210", "+91 98765-43210", "919876543210", "09876543210" → "9876543210"
function normalizePhone(value) {
  if (typeof value !== "string" || value.length > 20) throw new ValidationError(INVALID);
  let digits = value.trim().replace(/[\s-]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!MOBILE.test(digits)) throw new ValidationError(INVALID);
  return digits;
}

// The stored 10 digits in international form, for responses
const toE164 = (digits) => (typeof digits === "string" && MOBILE.test(digits) ? `+91${digits}` : null);

module.exports = { normalizePhone, toE164, MOBILE };
