// Referrals (meal marketing phase 5, 2026-11-10): pure rules, unit-tested. A member's code is
// JF + 6 letters and digits; a friend who enters it gets ₹50 off their first order (above ₹149),
// and once that order is delivered the member who shared gets ₹50 off one order. Rewards are
// personal coupons (meal_coupons.owner_user_id) so the order's own coupon checks apply.
const crypto = require("node:crypto");
const { ValidationError } = require("../profile");

const REWARD_PAISE = 5000;
const MIN_ORDER_PAISE = 14900;
const FRIEND_DAYS = 30; // the friend's coupon works this long
const REFERRER_DAYS = 60; // the reward coupon works this long
const CLAIM_WITHIN_DAYS = 30; // a code can be entered only this long after the account was made
const MAX_REWARDS = 20; // rewards a member can earn in all
// No 0/O or 1/I, so a code read aloud is typed right
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const randomCode = (prefix, length) => prefix + Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
const referralCode = () => randomCode("JF", 6);
const couponCode = () => randomCode("R", 7);

/** POST /api/referrals/claim { code } */
function claimBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "code")) throw new ValidationError("Send the code as { code }.");
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^JF[A-Z0-9]{6}$/.test(code)) throw new ValidationError("A friend's code is JF and 6 letters or digits.");
  return { code };
}

/** Why this member can't use a friend's code, or null */
function claimProblem({ self, referrerRole, ageDays, orders, claimed }) {
  if (self) return "That's your own code. Share it with a friend.";
  if (referrerRole !== "user") return "That code isn't valid.";
  if (claimed) return "You've already used a friend's code.";
  if (orders > 0) return "Friend codes are for a first order.";
  if (ageDays > CLAIM_WITHIN_DAYS) return `Friend codes work in an account's first ${CLAIM_WITHIN_DAYS} days.`;
  return null;
}

const shareText = (code) =>
  `Eat healthy with justFit! Use my code ${code} and get ₹${REWARD_PAISE / 100} off your first meal order (above ₹${MIN_ORDER_PAISE / 100}).`;

module.exports = {
  REWARD_PAISE, MIN_ORDER_PAISE, FRIEND_DAYS, REFERRER_DAYS, CLAIM_WITHIN_DAYS, MAX_REWARDS,
  referralCode, couponCode, claimBody, claimProblem, shareText,
};
