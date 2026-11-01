import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { useSegments } from "expo-router";

import { BottomTabBar } from "@/components/BottomTabBar";
import { homeTabs } from "@/data/home";
import { useThemeColors } from "@/theme";
import { trackScreen } from "@/lib/analytics";

// Home, Meals, AI Coach (raised, in the middle), Macro, Fitness (the workout route). The navigator's own bar is replaced by
// BottomTabBar, so only the custom pill is ever visible.
export default function TabsLayout() {
  const colors = useThemeColors();
  // The open tab, for App Usage (a tab re-tapped counts once; see trackScreen)
  const segments = useSegments();
  const tab = segments[segments.length - 1];
  useEffect(() => {
    if (tab) trackScreen(tab);
  }, [tab]);
  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      {homeTabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
