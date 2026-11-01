import type { AccountUser } from "@/lib/account";
import { formatIndianMobile } from "@/lib/phone";

// The first word of the account's name ("" until setup gives it one)
export function firstNameOf(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? "";
}

// How to show the account under its name: the email if it has one, otherwise its number
export function accountContact(user: AccountUser | null): string {
  if (!user) return "";
  if (user.email) return user.email;
  return user.phone ? `+91 ${formatIndianMobile(user.phone)}` : "";
}
