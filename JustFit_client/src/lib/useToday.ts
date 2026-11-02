import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { todayIso } from "@/lib/macro";

// Today's date (YYYY-MM-DD, local), read again whenever the app comes back to the foreground,
// so a screen left open past midnight moves to the new day instead of acting on yesterday
export function useToday(): string {
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setToday(todayIso());
    });
    return () => subscription.remove();
  }, []);
  return today;
}
