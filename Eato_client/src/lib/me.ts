import { useUser } from "@clerk/expo";

import type { Member } from "@/lib/community";

// The signed-in member as the community shows them (name from the account; the server
// uses the saved profile's name on anything it stores)
export function useMe(): Member {
  const { user } = useUser();
  const name = user?.fullName?.trim() || user?.firstName?.trim() || "You";
  return { id: user?.id ?? "me", name, initial: name.charAt(0).toUpperCase() };
}
