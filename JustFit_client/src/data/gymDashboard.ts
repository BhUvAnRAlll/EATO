import type { Icon } from "@/types/profile";
import type { MemberFilter, MemberStatus, PaymentKind, PayMethod, SaleCategory } from "@/lib/gymApi";

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

export const PLAN_MONTHS = [1, 3, 6, 12] as const;
export const planLabel = (months: number) => `${months} ${months === 1 ? "Month" : "Months"}`;

export const KIND_LABEL: Record<PaymentKind, string> = { admission: "Admission", renewal: "Renewal", due: "Due Paid", sale: "Sale" };
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
  { id: "expired", label: "Expired" },
  { id: "in_today", label: "In today" },
];

// What + offers
export const ADD_ACTIONS: { id: "admission" | "renewal" | "due" | "sale" | "enquiry"; label: string; note: string; icon: Icon }[] = [
  { id: "admission", label: "New admission", note: "A new member and their first payment", icon: { ios: "person.badge.plus", android: "person_add", web: "person_add" } },
  { id: "renewal", label: "Renewal", note: "A member renewing their plan", icon: { ios: "arrow.clockwise", android: "autorenew", web: "autorenew" } },
  { id: "due", label: "Due payment", note: "Money a member still owes", icon: { ios: "indianrupeesign.circle", android: "currency_rupee", web: "currency_rupee" } },
  { id: "sale", label: "Shop sale", note: "Supplements and merchandise", icon: { ios: "bag", android: "shopping_bag", web: "shopping_bag" } },
  { id: "enquiry", label: "Enquiry", note: "Someone asking about joining", icon: { ios: "questionmark.bubble", android: "contact_support", web: "contact_support" } },
];

// The portal's tabs, in order
export const gymTabs: { name: string; label: string; icon: Icon }[] = [
  { name: "index", label: "Home", icon: { ios: "house.fill", android: "home", web: "home" } },
  { name: "settings", label: "Settings", icon: { ios: "gearshape.fill", android: "settings", web: "settings" } },
  { name: "wallet", label: "Wallet", icon: { ios: "wallet.pass.fill", android: "account_balance_wallet", web: "account_balance_wallet" } },
];
