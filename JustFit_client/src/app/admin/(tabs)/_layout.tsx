import { Tabs } from "expo-router/js-tabs";

import { BottomTabBar } from "@/components/BottomTabBar";
import { adminTabs } from "@/data/admin";
import { useThemeColors } from "@/theme";

// Overview · Users · Content. Only justFit admins get here (the root layout); the server checks
// the role again.
export default function AdminTabsLayout() {
  const colors = useThemeColors();
  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} tabs={adminTabs} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.cream } }}
    >
      {adminTabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
