import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/community/CommunityStates";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { ownerComingSoon } from "@/data/owner";
import { colors } from "@/theme";

// Check-in: arrives in a later phase of the owner portal (see data/owner.ts)
export default function OwnerCheckin() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <OwnerHeader title="Check-in" subtitle="Check members in at the front desk and see who's in the gym." />
      <View className="flex-1 justify-center px-5">
        <EmptyState icon={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} title="Coming soon" text={ownerComingSoon.checkin} />
      </View>
    </SafeAreaView>
  );
}
