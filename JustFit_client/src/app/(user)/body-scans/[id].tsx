import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScanDetailView } from "@/components/bodyScan/ScanDetailView";
import { myScans } from "@/lib/bodyScansApi";
import { hud } from "@/lib/hud";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";

// Profile › My body scans › one scan: both photos and the report, and Delete, which removes the
// photos and the report from justFit for good (the body fat % saved on the profile stays).
export default function MyBodyScan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const load = useCallback((token: string | null) => myScans.one(token, id), [id]);
  const { result, retry } = useGymData(load);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (deleting) return;
    const sure = await confirmChoice({ title: "Delete this scan?", message: "Its photos and report are deleted from justFit for good. Your saved body fat % stays.", confirmLabel: "Delete", destructive: true });
    if (!sure) return;
    setDeleting(true);
    setError(null);
    const answer = await myScans.remove(await getToken().catch(() => null), id);
    setDeleting(false);
    if (!answer.ok) return setError(answer.error);
    hud.success("Scan deleted");
    if (router.canGoBack()) router.back();
    else router.replace("/body-scans");
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Body scan" fallback="/body-scans" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} showsVerticalScrollIndicator={false}>
          {result.state === "loading" ? <ScreenSkeleton cards={2} label="Loading the scan" /> : null}
          {result.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not open this scan" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /> : null}
          {result.state === "ready" ? (
            <>
              <ScanDetailView scan={result.data.scan} as="member" />
              {error ? <FormAlert message={error} /> : null}
              <Pressable onPress={remove} disabled={deleting} className="btn-outline" accessibilityRole="button">
                <Text className="btn-outline__label text-danger">{deleting ? "Deleting…" : "Delete this scan"}</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
