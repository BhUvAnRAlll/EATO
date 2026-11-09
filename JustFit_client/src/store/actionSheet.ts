import { create } from "zustand";

export type SheetAction = { label: string; destructive?: boolean; onPress: () => void };
export type OpenSheet = { title?: string; message?: string; actions: SheetAction[] };

// The action list lib/nativeSheets.ts shows on Android and the web (iPhone uses its own sheet),
// drawn by ActionSheetHost at the app's root
type ActionSheetState = {
  sheet: OpenSheet | null;
  open: (sheet: OpenSheet) => void;
  close: () => void;
};

export const useActionSheetStore = create<ActionSheetState>((set) => ({
  sheet: null,
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
}));
