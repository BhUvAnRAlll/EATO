import { Tabs } from "expo-router/js-tabs";

import { GymTabBar } from "@/components/gym/GymTabBar";
import { gymTabs } from "@/data/gymDashboard";
import { useThemeColors } from "@/theme";

// Home · Settings · Wallet. Only gym admins get here (the root
// layout); every gym route the server adds later checks the role again.
export default function GymTabsLayout() {
  const colors = useThemeColors();
  return (
    <Tabs tabBar={(props) => <GymTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.gymPage } }}>
      {gymTabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
