import { useState } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberList, isMemberFilter, type MemberPick } from "@/components/gym/MemberList";
import { parseExpiringDays } from "@/data/gymDashboard";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { GymScreen } from "@/components/gym/GymScreen";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// Gym admin › Members (Home's cards, + › Renewal / Due payment / PT, search): the member list in
// its own screen, opened on a filter or in pick mode
export default function GymMembers() {
  const params = useLocalSearchParams<{ filter?: string; days?: string; pick?: string; focus?: string }>();
  const [adding, setAdding] = useState(false);
  const colors = useThemeColors();
  const can = useCan();
  const pick: MemberPick = params.pick === "renewal" || params.pick === "due" || params.pick === "pt" ? params.pick : null;
  return (
    <GymScreen
      title={pick === "renewal" ? "Renewal: pick a member" : pick === "due" ? "Due payment: pick a member" : pick === "pt" ? "PT: pick a member" : "Members"}
      scroll={false}
      right={
        // The Add button (2026-11-08, the user's request; it was a plain text link): + Add on the gradient
        !pick && can("members.add") ? (
          <PressableScale onPress={() => setAdding(true)} haptic="tap" hitSlop={6} className="gym-header-add" accessibilityRole="button" accessibilityLabel="Add member">
            <GradientFill radius={12} />
            <GymIcon name="plus" size={18} color={colors.white} />
            <Text className="gym-header-add__label">Add</Text>
          </PressableScale>
        ) : undefined
      }
    >
      <MemberList pick={pick} initialFilter={isMemberFilter(params.filter) ? params.filter : "all"} initialDays={parseExpiringDays(params.days)} focusSearch={params.focus === "search"} addButton={false} />
      {adding && <AddMemberSheet onClose={() => setAdding(false)} onSaved={(detail) => { setAdding(false); router.push({ pathname: "/gym/members/[id]", params: { id: String(detail.member.id) } }); }} />}
    </GymScreen>
  );
}
