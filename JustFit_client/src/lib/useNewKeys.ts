import { useState } from "react";

import { newKeys } from "@/lib/motionRules";

// Which of a list's keys arrived after it was first shown, so only those get an entrance: a meal
// logged while the screen is open, a reply that just came back. What the screen opened with
// appears in place. Pass `ready` false while the list is still loading.
export function useNewKeys(keys: readonly string[], ready = true): Set<string> {
  const [first, setFirst] = useState<Set<string> | null>(null);
  // Remember the first list shown (React's "store information from previous renders" pattern)
  if (ready && !first) setFirst(new Set(keys));
  return newKeys(first, keys);
}
