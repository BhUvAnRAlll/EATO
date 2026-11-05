import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { useSegments } from "expo-router";

import { BottomTabBar } from "@/components/BottomTabBar";
import { homeTabs, trainerTabs } from "@/data/home";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";
import { trackScreen } from "@/lib/analytics";

// Home, Meals, AI Coach (raised, in the middle), Macro, Fitness (the workout route). The navigator's own bar is replaced by
// BottomTabBar, so only the custom pill is ever visible. A gym's trainer gets Home, Meals, Macro and
// My Clients instead: the bar shows only their tabs, and the Coach and Fitness screens send them Home.
// Every route is declared for everyone; a tab not in the bar can't be tapped.
export default function TabsLayout() {
  const colors = useThemeColors();
  const trainer = useAuthStore((state) => state.user?.role === "trainer");
  const tabs = trainer ? trainerTabs : homeTabs;
  // The open tab, for App Usage (a tab re-tapped counts once; see trackScreen)
  const segments = useSegments();
  const tab = segments[segments.length - 1];
  useEffect(() => {
    if (tab) trackScreen(tab);
  }, [tab]);
  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} tabs={tabs} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      {[...homeTabs, trainerTabs[trainerTabs.length - 1]].map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
