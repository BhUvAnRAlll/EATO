import { Stack } from "expo-router";

import { RecreateDraftProvider } from "@/components/workout/RecreateDraft";
import { useThemeColors } from "@/theme";

// "Rebuild my plan": six screens in one full-screen modal, sharing one draft of the answers.
// Nobody swipes out of the generating screen, and the reveal has no way back into the flow.
export default function RecreateLayout() {
  const colors = useThemeColors();
  return (
    <RecreateDraftProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="analysing" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="reveal" options={{ animation: "fade", gestureEnabled: false }} />
      </Stack>
    </RecreateDraftProvider>
  );
}
