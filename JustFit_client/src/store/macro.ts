import { useMemo } from "react";
import { AppState } from "react-native";
import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import { todayIso, weekEnding } from "@/lib/macro";

// The day every Macro screen is looking at. Held here, not by any one screen, so changing
// the day on the hub also changes it for the screens pushed over it.
type MacroState = {
  selectedDate: string;
  // The last day of the visible week strip
  weekAnchor: string;
  // Move inside the visible week
  selectDate: (date: string) => void;
  // Move the selection and the visible week (the calendar, "Back to today", deep links)
  jumpToDate: (date: string) => void;
};

export const useMacroStore = create<MacroState>((set) => ({
  selectedDate: todayIso(),
  weekAnchor: todayIso(),
  selectDate: (date) => set({ selectedDate: date }),
  jumpToDate: (date) => {
    const today = todayIso();
    set({ selectedDate: date, weekAnchor: date > today ? today : date });
  },
}));

// The next account starts on today
onAccountCleared(() => useMacroStore.setState({ selectedDate: todayIso(), weekAnchor: todayIso() }));

// The app left open past midnight: when it comes back, a member who was looking at "today" is
// moved to the new today (a past day they picked on purpose stays picked)
let lastToday = todayIso();
AppState.addEventListener("change", (state) => {
  if (state !== "active") return;
  const today = todayIso();
  if (today === lastToday) return;
  const { selectedDate, weekAnchor } = useMacroStore.getState();
  useMacroStore.setState({
    ...(selectedDate === lastToday ? { selectedDate: today } : {}),
    ...(weekAnchor === lastToday ? { weekAnchor: today } : {}),
  });
  lastToday = today;
});

// The visible week, oldest first (the same array until the week moves, so it is safe in
// effect dependencies)
export function useMacroWeek() {
  const anchor = useMacroStore((state) => state.weekAnchor);
  return useMemo(() => weekEnding(anchor), [anchor]);
}
