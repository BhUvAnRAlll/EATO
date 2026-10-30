// Indian mobile numbers for phone sign-in. The same rules as the server (JustFit_server/auth/phone.js),
// so the app can say "that's not a mobile number" before asking for a code; the server checks
// again either way. Pure: no React Native imports, unit-tested.

const MOBILE = /^[6-9][0-9]{9}$/;

// What someone typed (spaces, dashes, a +91, 91 or 0 in front) → the 10 digits, or null
export function normalizeIndianMobile(typed: string): string | null {
  let digits = typed.trim().replace(/[\s-]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return MOBILE.test(digits) ? digits : null;
}

// Keeps the phone field to what a number can hold: digits only, at most 10 after any +91
export function phoneInput(text: string): string {
  const digits = text.replace(/\D/g, "");
  const local = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return local.slice(0, 10);
}

// 9876543210 → "98765 43210" (how the app shows a number); anything else is returned as it is
export function formatIndianMobile(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/^\+91/, "");
  return MOBILE.test(digits) ? `${digits.slice(0, 5)} ${digits.slice(5)}` : value ?? "";
}

// A 6-digit code from what was typed or pasted (anything else is dropped)
export function codeInput(text: string): string {
  return text.replace(/\D/g, "").slice(0, 6);
}
