// The AI Coach's daily follow-up (2026-11-10): pure rules, unit-tested. In the evening the phone
// shows a local notification ("How did today go?"); tapping it opens the chat, which asks for
// today's follow-up. The coach writes it once a day from what the member logged, and it is saved
// as a coach message in their conversation, so the chat (and the coach) see it afterwards.
const crypto = require("node:crypto");

const { ValidationError } = require("../profile");
const { isoDate, isNearToday } = require("../macro/validate");
const { chatInstructions } = require("./chatRules");

const FAKE_FOLLOWUP = "**You hit your protein today**, nice work. Tomorrow, add a bowl of curd at lunch. (test follow-up)";

/** POST /followup { date }: today, as the member's phone has it */
function followupBody(body, now) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the day as JSON.");
  for (const key of Object.keys(body)) if (key !== "date") throw new ValidationError(`Unexpected field: ${key}.`);
  const date = isoDate(body.date, "Today");
  if (!isNearToday(date, now)) throw new ValidationError("Today must be today's date.");
  return { date };
}

/**
 * The follow-up's id in the chat (coach_chat_messages.client_id): the same member, day and coach
 * always give the same UUID, so a day's follow-up is written once and a retry reads it back.
 */
function followupId(userId, date, coach) {
  const h = crypto.createHash("sha256").update(`followup:${userId}:${date}:${coach}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** What the member did today with their workout, as one line for the brief */
function workoutLine({ weekdays }, date, status) {
  if (status === "completed") return "Today's workout: done.";
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!weekdays.includes(weekday)) return "Today is a rest day.";
  return status === "skipped" ? "Today's workout: skipped." : "Today's workout: not done yet.";
}

// The coach's chat instructions, then what this message is
function followupInstructions(intake) {
  return [
    chatInstructions(intake),
    "",
    "This time the member hasn't asked anything: you are writing their evening check-in on today, from the facts below. In two to four short sentences: one thing that went well today (or, if they logged nothing, ask kindly what they ate), the one most useful thing to do tonight or tomorrow, and a short warm line. Compare what they logged with their targets in plain numbers only when it helps. Write in English unless the conversation so far is in another language. Leave mealChanges and workoutChanges empty.",
  ].join("\n");
}

module.exports = { FAKE_FOLLOWUP, followupBody, followupId, workoutLine, followupInstructions };
