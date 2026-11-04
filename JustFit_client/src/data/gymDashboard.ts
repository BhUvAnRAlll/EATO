import type { Icon } from "@/types/profile";
import type { CatalogKind, MemberFilter, MemberStatus, PaymentKind, PayMethod, PlanUnit, SaleCategory } from "@/lib/gymApi";

// The gym admin portal's fixed words and small formatters. The numbers themselves come from the
// server (lib/gymApi.ts).

// ₹12,000 (Indian grouping: ₹1,25,000)
export const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

// 15 Oct 2026
export const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// "+919123456789" → "+91 91234 56789"
export const phoneText = (e164: string | null) => (e164 && /^\+91\d{10}$/.test(e164) ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164 ?? "");

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
  { id: "pt", label: "PT", noun: "PT package", example: "12 sessions" },
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
  { id: "expiring", label: "Expiring today" },
  { id: "expiring_soon", label: "Expiring in 1-3 days" },
  { id: "expired", label: "Expired" },
  { id: "in_today", label: "In today" },
  { id: "birthday", label: "Birthdays today" },
];

// What + offers
export const ADD_ACTIONS: { id: "admission" | "renewal" | "due" | "pt" | "service" | "sale" | "enquiry"; label: string; note: string; icon: Icon }[] = [
  { id: "admission", label: "New admission", note: "A new member and their first payment", icon: { ios: "person.badge.plus", android: "person_add", web: "person_add" } },
  { id: "renewal", label: "Renewal", note: "A member renewing their plan", icon: { ios: "arrow.clockwise", android: "autorenew", web: "autorenew" } },
  { id: "due", label: "Due payment", note: "Money a member still owes", icon: { ios: "indianrupeesign.circle", android: "currency_rupee", web: "currency_rupee" } },
  { id: "pt", label: "PT", note: "Personal training a member paid for", icon: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" } },
  { id: "service", label: "Service", note: "A steam bath, a diet plan, a body scan", icon: { ios: "sparkles", android: "spa", web: "spa" } },
  { id: "sale", label: "Product", note: "Supplements and merchandise sold", icon: { ios: "bag", android: "shopping_bag", web: "shopping_bag" } },
  { id: "enquiry", label: "Enquiry", note: "Someone asking about joining", icon: { ios: "questionmark.bubble", android: "contact_support", web: "contact_support" } },
];

// The portal's tabs, in order
export const gymTabs: { name: string; label: string; icon: Icon }[] = [
  { name: "index", label: "Home", icon: { ios: "house.fill", android: "home", web: "home" } },
  { name: "manage", label: "Manage", icon: { ios: "gearshape.fill", android: "settings", web: "settings" } },
  { name: "wallet", label: "Wallet", icon: { ios: "wallet.pass.fill", android: "account_balance_wallet", web: "account_balance_wallet" } },
];
