import type { GymIconName } from "@/constants/gymIcons";
import type { CatalogKind, EnquiryInterest, EnquirySource, EnquiryStatus, EnquiryView, Gender, MemberFilter, MemberStatus, PaymentKind, PayMethod, PlanUnit, SaleCategory } from "@/lib/gymApi";

// The gym admin portal's fixed words and small formatters. The numbers themselves come from the
// server (lib/gymApi.ts).

// ₹12,000 (Indian grouping: ₹1,25,000)
export const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

// 15 Oct 2026
// Home's greeting, by India's clock (UTC+5:30) whatever the phone's zone
const indiaNow = (now: Date) => new Date(now.getTime() + 330 * 60_000);
export const greetingFor = (now: Date) => {
  const hour = indiaNow(now).getUTCHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};
export const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// "+919123456789" → "+91 91234 56789"
export const phoneText = (e164: string | null) => (e164 && /^\+91\d{10}$/.test(e164) ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164 ?? "");

// What someone types or pastes into a mobile number field, kept to the 10 digits: "+91 98765 43210",
// "098765 43210" and "9876543210" all become "9876543210"; it never grows past 10
export function phoneInput(text: string) {
  let d = text.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  else if (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

// "Mohammed Asif" → "MA"
export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

// "15-08-1995" → "1995-08-15" (null until it's a whole date; the server checks it's real)
export function dobFromText(text: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
// Today in India, and a day some days from it, as YYYY-MM-DD: the server checks payment and due
// dates against India's date, so a phone or laptop on another zone (or UTC before 05:30 IST)
// mustn't default to yesterday
const IST_OFFSET_MS = 330 * 60 * 1000;
export const todayIso = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
export const daysFromToday = (days: number, now = new Date()) => todayIso(new Date(now.getTime() + days * 86400000));

// The first day of a plan that ends on `expiresOn` (the day after the same date a plan-length back)
export function planStart(expiresOn: string, duration: number, unit: PlanUnit) {
  const [y, m, d] = expiresOn.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  if (unit === "days") return new Date(Date.UTC(y, m - 1, d - duration + 1)).toISOString().slice(0, 10);
  const back = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() - duration, 1));
  const last = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth() + 1, 0)).getUTCDate();
  back.setUTCDate(Math.min(next.getUTCDate(), last));
  return back.toISOString().slice(0, 10);
}

// "1995-08-15" → "15-08-1995"
export const dobText = (iso: string | null) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "");
// Keeps digits and inserts the dashes as someone types a date: "15081995" → "15-08-1995"
export function dobInput(text: string) {
  const d = text.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("-");
}

// "3 Months", "15 Days"
export const planLabel = (duration: number, unit: PlanUnit = "months") =>
  `${duration} ${unit === "days" ? (duration === 1 ? "Day" : "Days") : duration === 1 ? "Month" : "Months"}`;
export const PLAN_LIMIT: Record<PlanUnit, number> = { months: 24, days: 365 };

export const KIND_LABEL: Record<PaymentKind, string> = { admission: "Admission", renewal: "Renewal", due: "Due Paid", pt: "PT", service: "Service", sale: "Product" };
export const CATALOG_KINDS: { id: CatalogKind; label: string; noun: string; example: string }[] = [
  { id: "plan", label: "Membership", noun: "membership plan", example: "3 Months" },
  { id: "pt", label: "PT", noun: "PT package", example: "1 Month PT" },
  { id: "service", label: "Service", noun: "service", example: "Steam bath" },
  { id: "product", label: "Product", noun: "product", example: "Whey Protein 1kg" },
];
export const METHOD_LABEL: Record<PayMethod, string> = { online: "Online", cash: "Cash" };
export const STATUS_LABEL: Record<MemberStatus, string> = { active: "Active", expiring: "Expires today", expired: "Expired" };
export const SALE_CATEGORIES: { id: SaleCategory; label: string }[] = [
  { id: "supplement", label: "Supplement" },
  { id: "merchandise", label: "Merchandise" },
  { id: "other", label: "Other" },
];
export const MEMBER_FILTERS: { id: MemberFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "due", label: "Due" },
  { id: "overdue", label: "Overdue" },
  { id: "expiring", label: "Expiring today" },
  { id: "expiring_soon", label: "Expiring in 1-3 days" },
  { id: "expired", label: "Expired" },
  { id: "in_today", label: "In today" },
  { id: "birthday", label: "Birthdays today" },
];

export const GENDER_LABEL: Record<Gender, string> = { male: "Male", female: "Female", other: "Other" };

// Manage › Enquiry: the lists, statuses and choices
export const ENQUIRY_VIEWS: { id: EnquiryView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "open", label: "Open" },
  { id: "joined", label: "Joined" },
  { id: "lost", label: "Not interested" },
  { id: "all", label: "All" },
];
export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = { new: "New", follow_up: "Follow-up", joined: "Joined", lost: "Not interested" };
export const INTEREST_LABEL: Record<EnquiryInterest, string> = { membership: "Membership", pt: "PT", trial: "Trial", other: "Other" };
export const SOURCE_LABEL: Record<EnquirySource, string> = { walk_in: "Walk-in", call: "Call", whatsapp: "WhatsApp", instagram: "Instagram", referral: "Referral", other: "Other" };

// "Follow up today", "Overdue by 2 days", "Follow up on 12 Nov 2026"
export function followUpText(followUpOn: string, today: string) {
  const days = Math.round((Date.parse(`${followUpOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days === 0) return { tone: "today" as const, text: "Follow up today" };
  if (days < 0) return { tone: "overdue" as const, text: `Overdue by ${-days} ${days === -1 ? "day" : "days"}` };
  if (days === 1) return { tone: "later" as const, text: "Follow up tomorrow" };
  return { tone: "later" as const, text: `Follow up on ${shortDate(followUpOn)}` };
}

// The + sheet on Home (the user's design)
export type AddAction = "member" | "plan" | "enquiry" | "expense" | "outlet" | "staff" | "sms" | "attendance";
export const ADD_SHEET: { id: AddAction; label: string; icon: GymIconName }[] = [
  { id: "member", label: "Add Member", icon: "user-plus" },
  { id: "plan", label: "Add Plan", icon: "clipboard-list" },
  { id: "enquiry", label: "Add Enquiry", icon: "message-circle-question" },
  { id: "expense", label: "Add Expense", icon: "credit-card" },
  { id: "outlet", label: "Add Outlet", icon: "store" },
  { id: "staff", label: "Add Staff / Admin Login", icon: "user-plus" },
  { id: "sms", label: "Send Bulk SMS", icon: "message-square-more" },
  { id: "attendance", label: "QR Attendance", icon: "qr-code" },
];


// The portal's tabs, in order
export const gymTabs: { name: string; label: string; icon: GymIconName }[] = [
  { name: "index", label: "Home", icon: "house" },
  { name: "manage", label: "Manage", icon: "layout-grid" },
  { name: "wallet", label: "Wallet", icon: "wallet" },
];
