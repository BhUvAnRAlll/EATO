import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { openTargets } from "@/lib/profileEdit";
import type { EditOrigin } from "@/lib/profileScan";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// Home's and Macro's card while the member has no daily targets (2026-11-10: setup asks only the
// personal details). The AI Coach intake sets the goal, activity and targets; a member who has
// done it but still has a step left (an estimate to pick, a doctor's target) gets the targets screen.
export function FinishProfileCard({ origin }: { origin: Extract<EditOrigin, "home" | "macro"> }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const problem = await openTargets(await getToken().catch(() => null), origin);
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <View className="card gap-3" accessibilityRole="summary">
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-pill bg-accent-soft">
          <SymbolView name={{ ios: "flame", android: "local_fire_department", web: "local_fire_department" }} size={22} tintColor={colors.leaf} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="card__title">Finish your profile</Text>
          <Text className="type-body text-muted">Answer a few questions from your AI Coach and we&apos;ll work out your daily calories and macros.</Text>
        </View>
      </View>
      {error && <FormAlert message={error} />}
      <PrimaryButton label="Set up my AI Coach" onPress={open} loading={busy} />
    </View>
  );
}
