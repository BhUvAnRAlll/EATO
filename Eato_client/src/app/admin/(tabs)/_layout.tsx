import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";

import { BottomTabBar } from "@/components/BottomTabBar";
import { adminTabs } from "@/data/admin";
import { adminPortal } from "@/lib/adminPortal";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Overview · Users · Gyms · Reports · Content. Reports carries a badge with the open report
// groups. Only JustFit admins get here (the root layout); the server checks the role again.
export default function AdminTabsLayout() {
  const getToken = useSessionToken();
  const [openReports, setOpenReports] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await adminPortal.overview(await getToken().catch(() => null));
        if (!cancelled && result.ok) setOpenReports(result.data.counts.openReports);
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken]),
  );

  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} tabs={adminTabs} badges={{ reports: openReports }} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.cream } }}
    >
      {adminTabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
