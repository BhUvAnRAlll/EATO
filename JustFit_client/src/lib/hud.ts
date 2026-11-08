import { AccessibilityInfo } from "react-native";

import { haptic } from "@/lib/haptics";
import { OFFLINE_TEXT, hudText } from "@/lib/hudRules";
import { useHudStore } from "@/store/hud";

// Short feedback that comes and goes by itself (components/Hud.tsx draws it): a centred HUD on
// iPhone, a snackbar at the bottom on Android and the web. It never blocks a touch.
//   hud.success("Checked in")         a finished action, with the success buzz
//   hud.error("Couldn't open Mail")   an action that failed and has no error line of its own
//   hud.offline()                     a save that never reached the server (lib/api.ts)
// Each plays its own haptic, so a caller uses hud.* instead of haptic.success()/error(), not both.
// Screen readers hear the message too.
function say(text: string) {
  AccessibilityInfo.announceForAccessibility(hudText(text));
}

export const hud = {
  success(text: string) {
    haptic.success();
    useHudStore.getState().show("success", text);
    say(text);
  },
  error(text: string) {
    haptic.error();
    useHudStore.getState().show("error", text);
    say(text);
  },
  offline() {
    haptic.error();
    useHudStore.getState().show("offline", OFFLINE_TEXT);
    say(OFFLINE_TEXT);
  },
};
