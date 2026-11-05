import { Text } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { GymScreen } from "@/components/gym/GymScreen";
import { VisitHistory } from "@/components/gym/VisitHistory";

// Gym admin › a member's attendance history: their visits at this branch (30 days to start),
// filtered and exported like the dashboard's. The server scopes it to this branch's member.
export default function GymMemberAttendance() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const memberId = Number(id);
  return (
    <GymScreen title={name ? `${name}: attendance` : "Attendance history"}>
      {Number.isInteger(memberId) && memberId > 0 ? <VisitHistory memberId={memberId} defaultRange="month" /> : <Text className="gym-tx__meta">{"That member link isn't valid."}</Text>}
    </GymScreen>
  );
}
