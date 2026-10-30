import type { AccountUser } from "@/lib/account";
import type { Member } from "@/lib/community";
import { formatIndianMobile } from "@/lib/phone";
import { useAuthStore } from "@/store/auth";

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

// The signed-in member as the community shows them (name from the account; the server
// uses the saved profile's name on anything it stores)
export function useMe(): Member {
  const user = useAuthStore((state) => state.user);
  const name = user?.fullName?.trim() || "You";
  return { id: user?.id ?? "me", name, initial: name.charAt(0).toUpperCase() };
}
