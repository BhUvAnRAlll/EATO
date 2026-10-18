// Labels and small rules the gym screens share. Pure (no React Native, no "@/" imports) so they
// are unit-tested with node --test. The server decides every permission (Eato_server/gyms/);
// these only choose what to show.
export type GymRole = "owner" | "admin" | "trainer" | "member";
export type MembershipStatus = "active" | "pending" | "suspended";
export type GymVisibility = "public" | "private" | "hidden";

export const roleLabels: Record<GymRole, string> = { owner: "Owner", admin: "Admin", trainer: "Trainer", member: "Member" };

export const visibilityLabels: Record<GymVisibility, { label: string; hint: string }> = {
  public: { label: "Public", hint: "Anyone can see posts and join." },
  private: { label: "Private", hint: "Listed, but only members see posts. Joining needs approval." },
  hidden: { label: "Hidden", hint: "Only members and people with an invite code can find it." },
};

export const settingOptions = {
  whoCanPost: [
    { value: "everyone", label: "Everyone" },
    { value: "trainers", label: "Trainers and admins" },
    { value: "admins", label: "Admins only" },
  ],
  whoCanComment: [
    { value: "members", label: "All members" },
    { value: "trainers", label: "Trainers and admins" },
    { value: "off", label: "Off (admins only)" },
  ],
  whoCanCreateEvents: [
    { value: "members", label: "All members" },
    { value: "trainers", label: "Trainers and admins" },
    { value: "admins", label: "Admins only" },
  ],
} as const;

export const plans = [
  { id: "starter", name: "Starter", price: "Free", perks: "Up to 100 members, feed and events" },
  { id: "pro", name: "Pro", price: "₹2,999/mo", perks: "Up to 1,000 members, announcements, invitations" },
  { id: "elite", name: "Elite", price: "₹7,999/mo", perks: "Unlimited members, priority support" },
] as const;

// The membership button on a gym: what it says and what tapping it does
export type MembershipButton = { label: string; action: "join" | "request" | "cancel" | "leave" | null; tone: "primary" | "soft" };

export function membershipButton(membership: { role: GymRole; status: MembershipStatus } | null, joinMode: "join" | "request"): MembershipButton {
  if (!membership) return joinMode === "join" ? { label: "Join Gym", action: "join", tone: "primary" } : { label: "Request to Join", action: "request", tone: "primary" };
  if (membership.status === "pending") return { label: "Pending approval", action: "cancel", tone: "soft" };
  if (membership.status === "suspended") return { label: "Suspended", action: null, tone: "soft" };
  return { label: membership.role === "member" ? "Joined" : roleLabels[membership.role], action: membership.role === "owner" ? null : "leave", tone: "soft" };
}

// An event is past once its end time has gone by on the member's own clock
export function isEventPast(event: { date: string; endTime: string }, now: Date): boolean {
  const [y, m, d] = event.date.split("-").map(Number);
  const [hh, mm] = event.endTime.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime() <= now.getTime();
}

// Upcoming soonest first, past latest first
export function splitEvents<T extends { date: string; startTime: string; endTime: string }>(events: T[], now: Date): { upcoming: T[]; past: T[] } {
  const key = (e: T) => `${e.date} ${e.startTime}`;
  return {
    upcoming: events.filter((e) => !isEventPast(e, now)).sort((a, b) => key(a).localeCompare(key(b))),
    past: events.filter((e) => isEventPast(e, now)).sort((a, b) => key(b).localeCompare(key(a))),
  };
}

// "Sat 25 Oct · 07:00–08:00"
export function eventWhen(event: { date: string; startTime: string; endTime: string }): string {
  const [y, m, d] = event.date.split("-").map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${event.startTime}–${event.endTime}`;
}

// "3 of 12 going", "Full · 12 of 12", "5 going"
export function attendance(event: { attendeeCount: number; maxAttendees: number | null }): string {
  if (event.maxAttendees === null) return `${event.attendeeCount} going`;
  return event.attendeeCount >= event.maxAttendees ? `Full · ${event.attendeeCount} of ${event.maxAttendees}` : `${event.attendeeCount} of ${event.maxAttendees} going`;
}

// A code as people read it aloud: "ABCD-EFGH"
export const formatCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

// The text shared with an invite link (nothing is sent by EATO itself)
export function inviteMessage(gymName: string, code: string, link: string): string {
  return `Join ${gymName} on EATO: ${link}\nOr enter the code ${formatCode(code)} under Community → Gyms → Join.`;
}

// ---- the profile editor's plain-text lists ----
// Hours, tiers, facilities and guidelines are edited as one entry per line, so the form stays
// a few text boxes. These turn the text into the lists the server expects, and back again.

const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);

// "Mon–Fri: 5am–11pm" per line → [{ label, value }]; a line without ":" is skipped
export function parseHours(text: string): { label: string; value: string }[] {
  return lines(text).flatMap((line) => {
    const at = line.indexOf(":");
    if (at <= 0) return [];
    const label = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    return label && value ? [{ label, value }] : [];
  });
}
export const hoursText = (hours: { label: string; value: string }[]) => hours.map((h) => `${h.label}: ${h.value}`).join("\n");

// "Basic | ₹1,499/mo | Gym floor and lockers" per line → [{ name, price, perks }]
export function parseTiers(text: string): { name: string; price: string; perks: string }[] {
  return lines(text).flatMap((line) => {
    const [name = "", price = "", ...rest] = line.split("|").map((part) => part.trim());
    return name && price ? [{ name, price, perks: rest.join(" | ") }] : [];
  });
}
export const tiersText = (tiers: { name: string; price: string; perks: string }[]) => tiers.map((t) => [t.name, t.price, t.perks].filter(Boolean).join(" | ")).join("\n");

// Facilities: comma or line separated; guidelines: one per line
export const parseFacilities = (text: string) => text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
export const parseGuidelines = lines;

// What a scanned QR code holds: an invite link (".../community/gyms/invite/CODE", from the
// invite screen) or a bare code. Returns the code, or null for anything else.
export function codeFromScan(data: string): string | null {
  const text = data.trim();
  const fromLink = /\/gyms\/invite\/([A-Za-z0-9-]{8,12})\/?(?:[?#].*)?$/.exec(text);
  const code = (fromLink ? fromLink[1] : text).replace(/-/g, "").toUpperCase();
  return /^[A-Z0-9]{8,10}$/.test(code) ? code : null;
}

// "09:00" → "9:00 AM", "18:30" → "6:30 PM"
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

// The date block on an event card: { month: "OCT", day: "19", weekday: "Mon" } (a calendar date, no time zone shift)
export function eventDateParts(date: string): { month: string; day: string; weekday: string } {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(y, m - 1, d);
  return {
    month: value.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
    day: String(d),
    weekday: value.toLocaleDateString("en-GB", { weekday: "short" }),
  };
}
