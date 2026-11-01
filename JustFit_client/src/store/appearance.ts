import { Appearance, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

// The app's appearance: Light (the default), Dark, or System (follow the phone's setting).
// The choice is kept on this device only (it isn't account data, so it survives sign-out)
// and changed from Profile › Appearance. It is applied with Appearance.setColorScheme, which
// every colour in the app follows: NativeWind's CSS variables, useThemeColors(), the status
// bar, the keyboard and system sheets. The web build (tests only) follows the browser.
export type AppearanceMode = "light" | "dark" | "system";
export const DEFAULT_APPEARANCE: AppearanceMode = "light";

const KEY = "justfit.appearance";
const isMode = (value: unknown): value is AppearanceMode => value === "light" || value === "dark" || value === "system";

function apply(mode: AppearanceMode) {
  if (Platform.OS === "web") return;
  Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);
}

async function read(): Promise<AppearanceMode> {
  try {
    const value = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return isMode(value) ? value : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

async function write(mode: AppearanceMode) {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, mode);
    else await SecureStore.setItemAsync(KEY, mode);
  } catch {
    // not saved: the choice still holds until the app is closed
  }
}

type AppearanceState = {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
};

export const useAppearanceStore = create<AppearanceState>((set) => ({
  mode: DEFAULT_APPEARANCE,
  setMode: (mode) => {
    apply(mode);
    set({ mode });
    write(mode);
  },
}));

// Called once at launch (root layout), while the launch screen is still up: light straight
// away, then the saved choice if there is one
export function startAppearance() {
  apply(DEFAULT_APPEARANCE);
  read().then((mode) => {
    if (mode !== useAppearanceStore.getState().mode) useAppearanceStore.getState().setMode(mode);
  });
}
