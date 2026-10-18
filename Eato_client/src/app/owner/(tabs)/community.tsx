import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/community/CommunityStates";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { ownerComingSoon } from "@/data/owner";
import { colors } from "@/theme";

// Community: arrives in a later phase of the owner portal (see data/owner.ts)
export default function OwnerCommunity() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <OwnerHeader title="Community" subtitle="Everything members see in your gym, in one place." />
      <View className="flex-1 justify-center px-5">
        <EmptyState icon={{ ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" }} title="Coming soon" text={ownerComingSoon.community} />
      </View>
    </SafeAreaView>
  );
}
