import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { openGoalEdit } from "@/lib/profileEdit";
import type { EditOrigin } from "@/lib/profileScan";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// Home's and Macro's card while the member has no daily targets (2026-11-10: setup asks only the
// personal details). Opens Profile › Goal & activity, which works the targets out and returns
// here; the AI Coach intake sets them too.
export function FinishProfileCard({ origin }: { origin: Extract<EditOrigin, "home" | "macro"> }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const problem = await openGoalEdit(await getToken().catch(() => null), origin);
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
          <Text className="type-body text-muted">Add your goal and how active you are, and we&apos;ll work out your daily calories and macros.</Text>
        </View>
      </View>
      {error && <FormAlert message={error} />}
      <PrimaryButton label="Add goal & activity" onPress={open} loading={busy} />
      <Text className="type-caption text-center text-muted">Or answer your AI Coach&apos;s questions: they set your targets too.</Text>
    </View>
  );
}
