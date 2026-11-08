import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { initialsOf } from "@/data/gymDashboard";
import { gymApi } from "@/lib/gymApi";
import { NO_MODULES, optionsLine } from "@/lib/permissionTree";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Gym admin › ☰ › Role & Permission: every Staff login at this branch with what they can open;
// tapping one opens their tiles and options (permissions/[userId].tsx; read again on return). Only the gym admin reaches it (the server
// answers Staff with a 403). Trainers aren't listed: they have no portal.
export default function GymPermissionsScreen() {
  const colors = useThemeColors();
  const { result, retry } = useGymData(gymApi.team);

  if (result.state !== "ready") {
    return (
      <GymScreen title="Role & Permission">
        {result.state === "loading" ? <GymLoading label="Loading your team" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  const { gym, team, permissionTree } = result.data;
  if (permissionTree.length === 0) {
    return (
      <GymScreen title="Role & Permission">
        <GymError error={NO_MODULES} onRetry={retry} />
      </GymScreen>
    );
  }
  const staff = team.filter((m) => m.kind === "staff");

  return (
    <GymScreen title="Role & Permission">
      <Text className="gym-tx__meta">{`Choose what each Staff login can open at the ${gym.branch} branch. You, the gym admin, can open everything.`}</Text>

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
            const line = optionsLine(permissionTree, m.options);
            return (
              <PressableScale key={m.id} onPress={() => router.push({ pathname: "/gym/permissions/[userId]", params: { userId: m.id } })} className="gym-card gym-tx" accessibilityRole="button" accessibilityLabel={`${name}: ${line}. Change permissions`}>
                <View className="gym-avatar">
                  <Text className="gym-avatar__label">{m.name ? initialsOf(m.name) : "?"}</Text>
                </View>
                <View className="min-w-0 flex-1" style={{ gap: 4 }}>
                  <Text className="gym-tx__name" numberOfLines={1}>{name}</Text>
                  <Text className="gym-tx__meta" numberOfLines={2}>{line}</Text>
                </View>
                <GymIcon name="chevron-right" size={16} color={colors.gymFaint} />
              </PressableScale>
            );
          })}
        </View>
      )}

    </GymScreen>
  );
}
