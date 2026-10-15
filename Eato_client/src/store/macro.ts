import { useMemo } from "react";
import { create } from "zustand";

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

// The visible week, oldest first (the same array until the week moves, so it is safe in
// effect dependencies)
export function useMacroWeek() {
  const anchor = useMacroStore((state) => state.weekAnchor);
  return useMemo(() => weekEnding(anchor), [anchor]);
}
