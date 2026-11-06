import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { PermissionsSheet } from "@/components/gym/PermissionsSheet";
import { areasLine, initialsOf } from "@/data/gymDashboard";
import { gymApi, type TeamMember } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Gym admin › ☰ › Role & Permission: every Staff login at this branch with what they can open;
// tapping one opens the switches (PermissionsSheet). Only the gym admin reaches it (the server
// answers Staff with a 403). Trainers aren't listed: they have no portal.
export default function GymPermissionsScreen() {
  const colors = useThemeColors();
  const { result, retry, set } = useGymData(gymApi.team);
  const [picked, setPicked] = useState<TeamMember | null>(null);
  const [notice, setNotice] = useState("");

  if (result.state !== "ready") {
    return (
      <GymScreen title="Role & Permission">
        {result.state === "loading" ? <GymLoading label="Loading your team" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  const { gym, team } = result.data;
  const branchLine = `${gym.name}, ${gym.branch}`;
  const staff = team.filter((m) => m.kind === "staff");

  return (
    <GymScreen title="Role & Permission">
      <Text className="gym-tx__meta">{`Choose what each Staff login can open at the ${gym.branch} branch. You, the gym admin, can open everything.`}</Text>
      {notice ? (
        <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)} className="gym-note" accessibilityLiveRegion="polite">
          <GymIcon name="circle-check" size={18} color={colors.gymSuccess} />
          <Text className="gym-note__text">{notice}</Text>
        </Animated.View>
      ) : null}

      <Text className="gym-section-title" accessibilityRole="header">{`Staff (${staff.length})`}</Text>
      {staff.length === 0 ? (
        <>
          <GymEmpty icon="shield-check" title="No Staff logins yet" text="Add someone as Staff first, then choose what they can open here." />
          <PressableScale onPress={() => router.push("/gym/staff?add=1")} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Add Staff / Admin Login">
            <Text className="gym-btn__label" style={{ color: colors.gymPrimary }}>Add Staff / Admin Login</Text>
          </PressableScale>
        </>
      ) : (
        <View style={{ gap: 10 }}>
          {staff.map((m) => {
            const name = m.name ?? "Name not added yet";
            return (
              <PressableScale key={m.id} onPress={() => { setNotice(""); setPicked(m); }} className="gym-card gym-tx" accessibilityRole="button" accessibilityLabel={`${name}: ${areasLine(m.areas)}. Change permissions`}>
                <View className="gym-avatar">
                  <Text className="gym-avatar__label">{m.name ? initialsOf(m.name) : "?"}</Text>
                </View>
                <View className="min-w-0 flex-1" style={{ gap: 4 }}>
                  <Text className="gym-tx__name" numberOfLines={1}>{name}</Text>
                  <Text className="gym-tx__meta" numberOfLines={2}>{areasLine(m.areas)}</Text>
                </View>
                <GymIcon name="chevron-right" size={16} color={colors.gymFaint} />
              </PressableScale>
            );
          })}
        </View>
      )}

      {picked && (
        <PermissionsSheet
          member={picked}
          branchLine={branchLine}
          onClose={() => setPicked(null)}
          onSaved={(data) => {
            set(data);
            setPicked(null);
            setNotice(`Saved. ${picked.name ?? "They"} can open: ${areasLine(data.team.find((m) => m.id === picked.id)?.areas ?? [])}.`);
          }}
        />
      )}
    </GymScreen>
  );
}
