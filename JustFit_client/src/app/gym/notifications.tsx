import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { NotificationInbox } from "@/components/NotificationInbox";
import { ScreenHeader } from "@/components/ScreenHeader";

// Gym portal › Notifications: pause requests, new members, expiring memberships and crowd alerts for this login
// (components/NotificationInbox.tsx; the brief's section 9). No push yet: shown here in the app.
export default function Notifications() {
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Notifications" fallback="/gym" />
        <NotificationInbox />
      </SafeAreaView>
    </View>
  );
}
