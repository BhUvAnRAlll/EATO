import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { MemberList, isMemberFilter, type MemberPick } from "@/components/gym/MemberList";
import { GymScreen } from "@/components/gym/GymScreen";

// Gym admin › Members (Home's cards, + › Renewal / Due payment / PT, search): the member list in
// its own screen, opened on a filter or in pick mode
export default function GymMembers() {
  const params = useLocalSearchParams<{ filter?: string; pick?: string; focus?: string }>();
  const pick: MemberPick = params.pick === "renewal" || params.pick === "due" || params.pick === "pt" ? params.pick : null;
  return (
    <GymScreen
      title={pick === "renewal" ? "Renewal: pick a member" : pick === "due" ? "Due payment: pick a member" : pick === "pt" ? "PT: pick a member" : "Members"}
      scroll={false}
      right={
        !pick ? (
          <PressableScale onPress={() => router.push("/gym/admission")} hitSlop={8} accessibilityRole="button" accessibilityLabel="New admission">
            <Text className="gym-link">Add</Text>
          </PressableScale>
        ) : undefined
      }
    >
      <MemberList pick={pick} initialFilter={isMemberFilter(params.filter) ? params.filter : "all"} focusSearch={params.focus === "search"} />
    </GymScreen>
  );
}
