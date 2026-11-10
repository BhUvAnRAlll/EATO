import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { useLocalSearchParams } from "expo-router";

import { openGoalEdit } from "@/lib/profileEdit";
import { editOrigin } from "@/lib/profileScan";
import { useSessionToken } from "@/lib/session";

// /goals (a home promotion can link here): opens Profile › Goal & activity with the saved
// answers, in this screen's place
export default function Goals() {
  const getToken = useSessionToken();
  const [error, setError] = useState<string | null>(null);
  // ?from=home|macro|profile: where the edit returns once the targets are saved
  const { from } = useLocalSearchParams<{ from?: string }>();
  const origin = editOrigin(from);
  useEffect(() => {
    (async () => setError(await openGoalEdit(await getToken().catch(() => null), origin, { replace: true })))();
  }, [getToken, origin]);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScreenHeader title="Goal & activity" fallback="/profile" />
      <View className="px-4 pt-4">
        {error ? <EmptyState icon={{ ios: "target", android: "track_changes", web: "track_changes" }} title="Couldn't open your goal" message={error} /> : <ScreenSkeleton cards={1} label="Opening your goal" />}
      </View>
    </SafeAreaView>
  );
}
