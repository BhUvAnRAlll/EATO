import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { GymPageView } from "@/components/gymHub/GymPageView";
import { JoinSheet, type JoinPick } from "@/components/gymHub/JoinSheet";
import { ReportGymSheet } from "@/components/gymHub/ReportGymSheet";
import { ReviewSheet } from "@/components/gymHub/ReviewSheet";
import { discoverApi, type GymPage, type JoinRequest } from "@/lib/discoverApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string; missing: boolean } | { state: "ready"; gym: GymPage; at: number };

// Gym Hub › Discover Gyms › a gym (phase 3, 2026-11-09): what the gym published for members, drawn
// by GymPageView (the gym's own preview uses it too): photos, open now, Call, WhatsApp and
// Directions, about, facilities, hours and closures, the plans to compare, PT packages, the address,
// contacts and links. No buying: since phase 4 the
// member asks the gym to call them about a plan (Ask about this plan, or Ask to join), which lands
// in the gym's Enquiries; the page then shows the request, or that they are a member here. Since
// Gym Profile phase 4 the member reviews the gym here too (ReviewSheet), if they are or were one.
export default function GymDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [result, setResult] = useState<Load>({ state: "loading" });
  const colors = useThemeColors();
  const [pick, setPick] = useState<JoinPick | null>(null);
  // Report a problem (the brief's section 7): to the justFit team, never the gym
  const [reporting, setReporting] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    const answer = await discoverApi.gym(await getToken().catch(() => null), Number(id));
    setResult((current) => (answer.ok ? { state: "ready", gym: answer.data, at: Date.now() } : current.state === "ready" ? current : { state: "failed", error: answer.error, missing: answer.status === 404 || answer.status === 400 }));
  }, [getToken, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { refreshControl } = usePullToRefresh(load);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-hub"));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader
          title={result.state === "ready" ? result.gym.name : "Gym"}
          subtitle={result.state === "ready" ? `${result.gym.branch} branch` : undefined}
          onBack={back}
          right={result.state === "ready" ? (
            <Pressable onPress={() => setReporting(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Report a problem with this gym">
              <SymbolView name={{ ios: "flag", android: "flag", web: "flag" }} size={18} tintColor={colors.faint} />
            </Pressable>
          ) : undefined}
        />
        {result.state === "loading" ? (
          <View className="p-4"><ScreenSkeleton cards={3} label="Loading the gym" hero /></View>
        ) : result.state === "failed" ? (
          <View className="p-4">
            <View className="card" style={{ gap: 12 }}>
              <FormAlert message={result.error} />
              {result.missing ? <PrimaryButton label="Back to Gym Hub" onPress={back} /> : <PrimaryButton label="Try again" onPress={() => { setResult({ state: "loading" }); load(); }} />}
            </View>
          </View>
        ) : (
          <GymPageView gym={result.gym} at={result.at} onAsk={setPick} onReview={() => setReviewing(true)} refreshControl={refreshControl} />
        )}
        {pick && result.state === "ready" && (
          <JoinSheet
            gymId={result.gym.id}
            gymName={result.gym.name}
            pick={pick}
            onClose={() => setPick(null)}
            onSent={(request: JoinRequest) => setResult((current) => (current.state === "ready" ? { ...current, gym: { ...current.gym, you: { memberId: current.gym.you?.memberId ?? null, request } } } : current))}
          />
        )}
        {reviewing && result.state === "ready" && (
          <ReviewSheet
            gymId={result.gym.id}
            gymName={result.gym.name}
            mine={result.gym.reviews?.mine ?? null}
            onClose={() => setReviewing(false)}
            onSaved={(reviews) => setResult((current) => (current.state === "ready" ? { ...current, gym: { ...current.gym, reviews } } : current))}
          />
        )}
        {reporting && result.state === "ready" && <ReportGymSheet gymId={result.gym.id} gymName={result.gym.name} onClose={() => setReporting(false)} />}
      </SafeAreaView>
    </View>
  );
}
