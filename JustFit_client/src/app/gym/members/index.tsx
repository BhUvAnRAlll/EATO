import { useState } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { MemberList, isMemberFilter, type MemberPick } from "@/components/gym/MemberList";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { GymScreen } from "@/components/gym/GymScreen";

// Gym admin › Members (Home's cards, + › Renewal / Due payment / PT, search): the member list in
// its own screen, opened on a filter or in pick mode
export default function GymMembers() {
  const params = useLocalSearchParams<{ filter?: string; pick?: string; focus?: string }>();
  const [adding, setAdding] = useState(false);
  const pick: MemberPick = params.pick === "renewal" || params.pick === "due" || params.pick === "pt" ? params.pick : null;
  return (
    <GymScreen
      title={pick === "renewal" ? "Renewal: pick a member" : pick === "due" ? "Due payment: pick a member" : pick === "pt" ? "PT: pick a member" : "Members"}
      scroll={false}
      right={
        !pick ? (
          <PressableScale onPress={() => setAdding(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add member">
            <Text className="gym-link">Add</Text>
          </PressableScale>
        ) : undefined
      }
    >
      <MemberList pick={pick} initialFilter={isMemberFilter(params.filter) ? params.filter : "all"} focusSearch={params.focus === "search"} />
      {adding && <AddMemberSheet onClose={() => setAdding(false)} onSaved={(detail) => { setAdding(false); router.push({ pathname: "/gym/members/[id]", params: { id: String(detail.member.id) } }); }} />}
    </GymScreen>
  );
}
