import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { gymApi, type GymBranches } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Gym admin › Branches (the ⇄ next to the location on Home): the gym's branches this account works
// at, the open one ticked. Tapping another opens it everywhere (the server remembers the choice).
// Edit this branch changes its name and place.
export default function GymBranchesScreen() {
  const colors = useThemeColors();
  const { result, retry, set } = useGymData(gymApi.branches);
  const [switching, setSwitching] = useState<number | null>(null);
  const { busy, error, save } = useGymSave((data: GymBranches) => {
    set(data);
    setSwitching(null);
    router.back();
  });

  return (
    <GymScreen title={result.state === "ready" ? `${result.data.gym} branches` : "Branches"}>
      {result.state === "loading" && <GymLoading label="Loading your branches" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        <>
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            {result.data.branches.map((b) => {
              const current = b.id === result.data.currentId;
              return (
                <PressableScale
                  key={b.id}
                  onPress={() => {
                    if (current) return router.back();
                    setSwitching(b.id);
                    save((token) => gymApi.switchBranch(token, b.id));
                  }}
                  disabled={busy}
                  haptic="select"
                  className={current ? "gym-card gym-tx gym-branch--current" : "gym-card gym-tx"}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={`${b.branch} branch, ${b.area}, ${b.city}`}
                >
                  <View className="gym-sms__icon">
                    <GymIcon name="map-pin" size={18} color={colors.gymPrimary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="gym-tx__name" numberOfLines={1}>{`${b.branch} branch`}</Text>
                    <Text className="gym-tx__meta" numberOfLines={1}>{`${b.area}, ${b.city}`}</Text>
                  </View>
                  {busy && switching === b.id ? (
                    <ActivityIndicator size="small" color={colors.gymPrimary} />
                  ) : current ? (
                    <GymIcon name="circle-check" size={20} color={colors.gymPrimary} />
                  ) : null}
                </PressableScale>
              );
            })}
          </View>
          {error ? <FormAlert message={error} /> : null}
          {result.data.branches.length === 1 && <Text className="gym-tx__meta">{"Your gym's other branches show here once the justFit team adds you to them."}</Text>}
          <PressableScale onPress={() => router.push("/gym/details")} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Edit this branch">
            <GymIcon name="pencil" size={15} color={colors.gymPrimary} />
            <Text className="gym-btn__label gym-btn__label--outline">Edit this branch</Text>
          </PressableScale>
        </>
      )}
    </GymScreen>
  );
}
