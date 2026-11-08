import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "@/components/SymbolView";
import { HUD_MS, topHost, type HudKind } from "@/lib/hudRules";
import { useHudStore } from "@/store/hud";
import { useThemeColors, type Palette } from "@/theme";

const ICON = {
  success: { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" },
  error: { ios: "exclamationmark.circle.fill", android: "error", web: "error" },
  offline: { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" },
} as const;

const tint = (kind: HudKind, colors: Palette) => (kind === "success" ? colors.success : kind === "error" ? colors.danger : colors.warning);

// iPhone shows feedback as a small HUD in the middle of the screen; Android (and the web) as a
// Material snackbar above the tab bar
const CENTRED = Platform.OS === "ios";
// Clears the tab bar (and a sheet's main button) so the snackbar never covers them
const BAR_LIFT = 88;

let nextHost = 1;
const newHostId = () => nextHost++;

// Draws lib/hud.ts's messages. Mounted once at the app's root and once inside each sheet (a Modal
// is its own window, so the root's would be hidden under it); only the newest mounted host draws.
// It never takes a touch, so nothing on screen is ever blocked.
export function HudHost() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [id] = useState(newHostId);
  const current = useHudStore((state) => state.current);
  const isTop = useHudStore((state) => topHost(state.hosts) === id);

  useEffect(() => {
    const { addHost, removeHost } = useHudStore.getState();
    addHost(id);
    return () => removeHost(id);
  }, [id]);

  // Each message hides itself after its time; a newer one restarts the clock
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => useHudStore.getState().hide(current.id), HUD_MS[current.kind]);
    return () => clearTimeout(timer);
  }, [current]);

  if (!isTop || !current) return null;

  // Keyed by what it says, not its id: the same message again (two saves failing at once) stays
  // put and only its timer restarts
  const key = `${current.kind}:${current.text}`;
  const entering = (CENTRED ? FadeIn.duration(160) : FadeInDown.duration(220)).reduceMotion(ReduceMotion.System);
  const exiting = FadeOut.duration(180).reduceMotion(ReduceMotion.System);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, CENTRED ? { alignItems: "center", justifyContent: "center" } : { justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: insets.bottom + BAR_LIFT }]}
    >
      <Animated.View key={key} entering={entering} exiting={exiting} className={CENTRED ? "hud hud--centre" : "hud hud--bar"} accessibilityLiveRegion="polite">
        <SymbolView name={ICON[current.kind]} size={CENTRED ? 34 : 20} tintColor={tint(current.kind, colors)} />
        <Text className={CENTRED ? "hud__label hud__label--centre" : "hud__label"} maxFontSizeMultiplier={1.4}>
          {current.text}
        </Text>
      </Animated.View>
    </View>
  );
}
