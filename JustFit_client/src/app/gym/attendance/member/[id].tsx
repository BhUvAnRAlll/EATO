import { useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { CorrectVisitSheet } from "@/components/gym/CorrectVisitSheet";
import { GymScreen } from "@/components/gym/GymScreen";
import { VisitHistory } from "@/components/gym/VisitHistory";
import type { GymVisit } from "@/lib/gymApi";
import { useCan } from "@/store/gymAccess";

// Gym admin › a member's attendance history: their visits at this branch (30 days to start),
// filtered and exported like the dashboard's. The server scopes it to this branch's member. With
// Attendance › Correct visits and add missed ones, a visit opens to correct it and "Add a missed
// visit" adds one, each with a reason (Attendance › Corrections keeps the history).
export default function GymMemberAttendance() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const memberId = Number(id);
  const can = useCan();
  const canCorrect = can("attendance.correct");
  const [sheet, setSheet] = useState<{ visit: GymVisit | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const valid = Number.isInteger(memberId) && memberId > 0;
  const right = valid && canCorrect ? (
    <PressableScale onPress={() => setSheet({ visit: null })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add a missed visit">
      <Text className="gym-link">Add visit</Text>
    </PressableScale>
  ) : undefined;
  return (
    <GymScreen title={name ? `${name}: attendance` : "Attendance history"} right={right}>
      {valid ? (
        <VisitHistory memberId={memberId} defaultRange="month" refreshKey={refreshKey} onVisitPress={canCorrect ? (visit) => setSheet({ visit }) : undefined} />
      ) : (
        <Text className="gym-tx__meta">{"That member link isn't valid."}</Text>
      )}
      {sheet && valid ? (
        <CorrectVisitSheet
          memberId={memberId}
          memberName={name ?? "Member"}
          visit={sheet.visit}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      ) : null}
    </GymScreen>
  );
}
