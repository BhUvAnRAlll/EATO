import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { gymApi } from "@/lib/gymApi";
import { yearsText } from "@/lib/gymProfile";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// Gym Profile › Trainers (Gym Profile Management phase 3, 2026-11-09): every trainer login at this
// branch with what members see of them (Shown or Hidden, specialisations, experience). A card opens
// the trainer's profile. Trainers are added and removed, and given their branches, under Staff /
// Admin Login (the gym admin's), linked at the bottom; a trainer shows at every branch they work at.
export default function GymProfileTrainers() {
  const colors = useThemeColors();
  const can = useCan();
  const { result, retry } = useGymData(gymApi.trainerProfiles);
  const branches = useGymData(gymApi.branches);
  const owner = branches.result.state === "ready" && branches.result.data.access === "owner";

  return (
    <GymScreen title="Trainers">
      <Text className="gym-tx__meta">Members see a trainer once you switch their profile on. A trainer shows at every branch they work at.</Text>
      {result.state === "loading" && <GymLoading label="Loading your trainers" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" &&
        (result.data.trainers.length === 0 ? (
          <GymEmpty icon="users" title="No trainers yet" text="Add your trainers under Staff / Admin Login as Trainer. Their profiles appear here." />
        ) : (
          <View style={{ gap: 10 }}>
            {result.data.trainers.map((t) => {
              const name = t.name ?? "Name not added yet";
              const line = [yearsText(t.years), t.specializations.slice(0, 2).join(" · ")].filter(Boolean).join(" · ") || "No profile yet";
              return (
                <PressableScale
                  key={t.userId}
                  onPress={() => router.push({ pathname: "/gym/profile/trainer/[userId]", params: { userId: t.userId } })}
                  className="gym-dash-card flex-row items-center"
                  style={{ padding: 12, gap: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}, ${t.active ? "shown to members" : "hidden from members"}. ${line}. ${can("profile.trainers") ? "Edit" : "Open"}`}
                >
                  <View style={{ width: 48, height: 48, borderRadius: 24, overflow: "hidden", backgroundColor: colors.gymPrimarySoft, alignItems: "center", justifyContent: "center" }}>
                    {t.photoUrl ? <MemberPhotoImage url={t.photoUrl} /> : <GymIcon name="user" size={22} color={colors.gymPrimary} />}
                  </View>
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="gym-dash-row__title" numberOfLines={1} style={t.name ? undefined : { color: colors.gymFaint }}>{name}</Text>
                    <Text className="gym-dash-row__text" numberOfLines={1}>{line}</Text>
                  </View>
                  <View className="gym-tag" style={{ backgroundColor: t.active ? colors.gymSuccessSoft : colors.gymWarningSoft }}>
                    <Text className="gym-tag__label" style={{ color: t.active ? colors.gymSuccess : colors.gymWarningInk }}>{t.active ? "Shown" : "Hidden"}</Text>
                  </View>
                  <GymIcon name="chevron-right" size={14} color={colors.gymFaint} />
                </PressableScale>
              );
            })}
          </View>
        ))}
      {owner && (
        <PressableScale onPress={() => router.push("/gym/staff")} className="gym-choice flex-row items-center justify-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Add or remove trainers">
          <GymIcon name="user-cog" size={16} color={colors.gymPrimary} />
          <Text className="gym-choice__label">Add or remove trainers</Text>
        </PressableScale>
      )}
    </GymScreen>
  );
}
