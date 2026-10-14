import { Tabs } from "expo-router/js-tabs";

import { BottomTabBar } from "@/components/BottomTabBar";
import { homeTabs } from "@/data/home";
import { colors } from "@/theme";

// Home, Meals, Macro, Fitness, Community. The navigator's own bar is replaced by
// BottomTabBar, so only the custom pill is ever visible.
export default function TabsLayout() {
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
