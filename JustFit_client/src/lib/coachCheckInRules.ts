// The coach's daily check-in notification (pure, unit-tested; 2026-11-10). Every evening at 8:30 pm
// the phone shows "Priya checked in on your day"; tapping it opens the chat, which asks the coach
// for today's check-in (POST /api/coach/followup, written once a day). The phone schedules it
// itself (lib/coachCheckIns.ts): no push server, no cost. The words can't name what the coach will
// say: that is written only when the member opens it.

export const CHECK_IN_ID = "justfit-coach-checkin";
export const CHECK_IN_ROUTE = "/coach/chat?followup=1";
export const CHECK_IN_HOUR = 20;
export const CHECK_IN_MINUTE = 30;

/** The notification's words, with the coach's first name when the app knows it */
export function checkInContent(coachName: string | null): { title: string; body: string } {
  const name = coachName?.trim();
  return {
    title: name ? `${name} checked in on your day` : "Your coach checked in on your day",
    body: "How did today go? Tap to read your coach's note on your food and training.",
  };
}
