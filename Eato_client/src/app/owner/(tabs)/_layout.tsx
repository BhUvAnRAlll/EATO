import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";

import { BottomTabBar } from "@/components/BottomTabBar";
import { EmptyState } from "@/components/community/CommunityStates";
import { ownerTabs } from "@/data/owner";
import { useSessionToken } from "@/lib/session";
import { ownerBadges, useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

// Home · Members · Check-in · Community · Review · Gym. Loads the gyms the caller runs (the
// first opens unless one was chosen) and the open gym's summary, whose counts badge the tabs.
export default function OwnerTabsLayout() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const gyms = useOwnerStore((state) => state.gyms);
  const summary = useOwnerStore((state) => state.summary);
  const loadGyms = useOwnerStore((state) => state.loadGyms);
  const loadSummary = useOwnerStore((state) => state.loadSummary);

  useEffect(() => {
    (async () => loadGyms(await getToken()))();
  }, [getToken, loadGyms]);

  useEffect(() => {
    if (gymId) (async () => loadSummary(await getToken()))();
  }, [gymId, getToken, loadSummary]);

  // Nobody runs a gym here (and no gym was opened from Admin › Gyms)
  if (gyms !== null && gyms.length === 0 && !gymId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
        <View className="flex-1 justify-center px-5">
          <EmptyState
            icon={{ ios: "building.2", android: "apartment", web: "apartment" }}
            title="No gym to manage"
            text="Gym Manager is for a gym's owner and admins. JustFit sets the owner when it creates a gym."
            actionLabel="Back to JustFit"
            onAction={() => router.replace("/")}
          />
        </View>
      </SafeAreaView>
    );
  }
  if (!gymId) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} tabs={ownerTabs} badges={ownerBadges(summary)} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.cream } }}
    >
      {ownerTabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
