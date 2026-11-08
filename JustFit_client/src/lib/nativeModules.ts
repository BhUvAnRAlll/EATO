import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// Whether this build of the app carries a native library's phone-side half (2026-11-08). A library
// added after the app was last built (expo-print, expo-image-manipulator on 2026-11-07) is in the
// JavaScript but not in the installed app until it is rebuilt (`npm run ios` / `npm run android`).
// Importing such a library at the top of a file throws "Cannot find native module" and takes the
// whole screen down, so screens load those libraries only when they're used, after this check, and
// say what to do instead of crashing. The web build has its own versions of them.
export const hasNativeModule = (name: string) => Platform.OS === "web" || requireOptionalNativeModule(name) !== null;

// What a screen says when a feature needs a newer build of the app
export const NEEDS_NEW_BUILD = "This copy of the app needs updating for that. Install the latest build, then try again.";
