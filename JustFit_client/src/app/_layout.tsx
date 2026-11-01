import "../global.css";

import { useEffect } from "react";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { ActivityIndicator, View } from "react-native";

import { fontFiles } from "@/constants/fonts";
import { useAuthStore } from "@/store/auth";
import { useScheme, useThemeColors } from "@/theme";
import { startAnalytics } from "@/lib/analytics";
import { startAppearance } from "@/store/appearance";

// Each role can only open its own dashboard. If someone opens a screen they
// aren't allowed to (or signs out), Expo Router sends them back to the start
// screen, which redirects them to the right place. The role is the server's answer
// to GET /api/auth/me for the saved session (store/auth.ts), never anything stored here.
// Keep the native launch screen up until the fonts and the saved session are ready, so the app
// opens straight onto its first real screen: no white flash, no font swap, no spinner. If the
// server is slow, the launch screen still gives way after LAUNCH_MAX_MS (the start screen then
// shows its own "couldn't reach" state).
SplashScreen.preventAutoHideAsync().catch(() => {});
// Light unless the member chose Dark or System in Profile › Appearance
startAppearance();
SplashScreen.setOptions({ duration: 250, fade: true });
const LAUNCH_MAX_MS = 6000;

let launched = false;
function hideLaunchScreen() {
  launched = true;
  SplashScreen.hideAsync().catch(() => {});
}

function RootStack() {
  const colors = useThemeColors();
  const scheme = useScheme();
  // The navigator paints its own background behind and between screens; give it the app's page
  // and card colours so a push, a swipe back or a modal never shows the library's default grey
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.ink, border: colors.line, notification: colors.primary } };
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => (state.status === "signedIn" ? state.user?.role ?? null : null));

  // Ask the server about the saved session once at launch (the store runs one check at a time)
  useEffect(() => {
    useAuthStore.getState().restore().then(startAnalytics);
    const timer = setTimeout(hideLaunchScreen, LAUNCH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  // The window behind every screen matches the page colour (light or dark), so a screen
  // transition or the keyboard never uncovers white
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  useEffect(() => {
    if (status !== "restoring") hideLaunchScreen();
  }, [status]);

  // Until the saved session has been checked, nobody's role is known yet. The guards below
  // would treat every screen as forbidden and send a deep link (a reloaded page or a shared
  // link) to the start screen, so wait here instead. This happens at launch and on "Try again".
  // At launch the launch screen covers this; on "Try again" a small spinner shows the check
  if (status === "restoring") {
    return <View className="flex-1 items-center justify-center bg-cream">{launched && <ActivityIndicator color={colors.leaf} />}</View>;
  }

  return (
    <ThemeProvider value={navTheme}>
    <StatusBar style="auto" />
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={role === "user"}>
        <Stack.Screen name="(user)" />
      </Stack.Protected>
      <Stack.Protected guard={role === "admin"}>
        <Stack.Screen name="admin" />
      </Stack.Protected>
    </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Poppins loads from the app bundle in a moment; if it ever fails, the system font is used
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  if (!fontsLoaded && !fontError) {
    return <View className="flex-1 bg-cream" />;
  }

  return <RootStack />;
}
