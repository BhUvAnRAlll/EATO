// In-app notifications (JustFit_server/notifications/, the brief's section 9): the shapes, the words
// and the one rule the app keeps itself: a notification opens only a screen on the same short list
// the server allows. Pure, unit-tested (lib/__tests__/notifications.test.ts).

export type NotificationCategory = "membership" | "pauses" | "attendance" | "gym" | "registration" | "platform";
export type AppNotification = { id: number; category: NotificationCategory; kind: string; title: string; body: string; link: string | null; read: boolean; at: string };
export type NotificationPage = { page: number; nextPage: number | null; unread: number; notifications: AppNotification[] };
// canChoose: false for members (their gym and justFit decide, 2026-11-10)
export type NotificationPrefs = { canChoose?: boolean; muted: NotificationCategory[]; categories: { id: NotificationCategory; label: string }[] };

const LINKS = [/^\/gym-hub(\/\d+)?$/, /^\/gym-hub\/gyms\/\d+$/, /^\/gym-register$/, /^\/gym\/pauses$/, /^\/gym\/members\/\d+$/, /^\/gym\/members$/, /^\/gym\/attendance$/, /^\/gym\/enquiries$/, /^\/admin\/gyms\/\d+$/, /^\/admin\/complaints\/\d+$/, /^\/gym$/, /^\/coach\/meal-plan$/];
export const safeLink = (link: string | null | undefined): string | null => (typeof link === "string" && LINKS.some((re) => re.test(link)) ? link : null);

// "just now", "5 min ago", "3 h ago", "yesterday", "12 Nov"
export function whenText(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Which categories each kind of account hears about (the switches shown on its screen)
export function categoriesFor(role: string | undefined): NotificationCategory[] {
  if (role === "admin") return ["registration", "platform"];
  if (role === "gym_admin") return ["pauses", "gym", "attendance", "registration"];
  return ["membership", "pauses", "gym", "registration"];
}
