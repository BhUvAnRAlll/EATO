import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/community/CommunityStates";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { ownerComingSoon } from "@/data/owner";
import { colors } from "@/theme";

// Review: arrives in a later phase of the owner portal (see data/owner.ts)
export default function OwnerReview() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <OwnerHeader title="Review" subtitle="Approve held posts and handle reports." />
      <View className="flex-1 justify-center px-5">
        <EmptyState icon={{ ios: "checkmark.shield", android: "verified_user", web: "verified_user" }} title="Coming soon" text={ownerComingSoon.review} />
      </View>
    </SafeAreaView>
  );
}
