import type { TabItem } from "@/components/BottomTabBar";
import type { NoticeAudience, NoticeTarget } from "@/lib/owner";

// The gym owner portal's tabs, in order (app/owner/(tabs)/)
export const ownerTabs: TabItem[] = [
  { name: "index", label: "Home", icon: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" } },
  { name: "members", label: "Members", icon: { ios: "person.2", android: "group", web: "group" } },
  { name: "checkin", label: "Check-in", icon: { ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" } },
  { name: "community", label: "Community", icon: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" } },
  { name: "review", label: "Review", icon: { ios: "checkmark.shield", android: "verified_user", web: "verified_user" } },
  { name: "gym", label: "Gym", icon: { ios: "building.2", android: "apartment", web: "apartment" } },
];

// Notify members: templates to start from (the owner edits them before sending)
export const noticeTemplates: { label: string; title: string; body: string; target: NoticeTarget }[] = [
  { label: "Closing early", title: "Closing early today", body: "We're closing early today. Thanks for understanding, and see you tomorrow!", target: "gym" },
  { label: "Class reminder", title: "Class reminder", body: "Your class starts soon. Bring water and a towel, and arrive 5 minutes early.", target: "events" },
  { label: "Renewal reminder", title: "Time to renew", body: "Your membership is ending soon. Visit the front desk to renew and keep training.", target: "gym" },
  { label: "We miss you", title: "We miss you!", body: "It's been a while. Come back for a session this week; your progress is waiting.", target: "my_qr" },
  { label: "Check-out reminder", title: "Don't forget to check out", body: "Scan the check-out QR at the exit on your way out.", target: "session" },
];

// What tapping a notice opens, and who it goes to
export const noticeTargets: { key: NoticeTarget; label: string }[] = [
  { key: "gym", label: "Gym page" },
  { key: "events", label: "Events" },
  { key: "my_qr", label: "My QR code" },
  { key: "session", label: "Active session" },
  { key: "none", label: "Nothing" },
];
export const noticeAudiences: { key: Exclude<NoticeAudience, "test">; label: string; note: string }[] = [
  { key: "everyone", label: "Everyone", note: "All active members and staff" },
  { key: "in_gym", label: "In the gym now", note: "Members checked in right now" },
  { key: "renewal_due", label: "Renewal due", note: "Packages ending in 14 days or already ended" },
  { key: "inactive", label: "Haven't visited", note: "No visit in the last 14 days" },
  { key: "staff", label: "Staff only", note: "Owners and admins" },
  { key: "chosen", label: "Choose people", note: "Pick members one by one" },
];
export const audienceLabel = (audience: NoticeAudience) => (audience === "test" ? "Test (only you)" : noticeAudiences.find((a) => a.key === audience)?.label ?? audience);
