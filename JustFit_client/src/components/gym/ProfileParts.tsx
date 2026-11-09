import { Text, View } from "react-native";

import { GymError, GymLoading } from "@/components/gym/GymStates";
import { gymApi, type GymProfile } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// Gym Profile's screens (2026-11-09) share these: the draft read once per screen (and again when it
// comes back to the front), and who may change it. The server checks the same options regardless.
export function useProfileDraft() {
  const can = useCan();
  const data = useGymData(gymApi.profile);
  return { ...data, canEdit: can("profile.edit"), canPublish: can("profile.publish") };
}

// The draft's loading and error states, then the screen's form with the answer
export function ProfileLoad({ result, retry, children }: { result: ReturnType<typeof useGymData<GymProfile>>["result"]; retry: () => void; children: (profile: GymProfile) => React.ReactNode }) {
  if (result.state === "loading") return <GymLoading label="Loading your gym profile" />;
  if (result.state === "failed") return <GymError error={result.error} onRetry={retry} />;
  return <>{children(result.data)}</>;
}

// "Saved to the draft. Members see it once you publish." under a section's Save
export function DraftNote({ canEdit }: { canEdit: boolean }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-start" style={{ gap: 6 }}>
      <Text className="gym-tx__meta" style={{ color: canEdit ? colors.gymMuted : colors.gymWarningInk }}>
        {canEdit ? "Changes are saved to your draft. Members see them once the profile is published." : "Your login can read the gym profile but not change it. Ask your gym admin."}
      </Text>
    </View>
  );
}
