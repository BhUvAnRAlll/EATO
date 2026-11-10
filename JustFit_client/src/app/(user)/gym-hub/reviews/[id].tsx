import { useCallback, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { ReviewCard, ReviewSummaryCard } from "@/components/gymHub/ReviewParts";
import { discoverApi, type GymReviews, type PublicReview } from "@/lib/discoverApi";
import { listPerf } from "@/lib/listPerf";
import { useSessionToken } from "@/lib/session";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: GymReviews; list: PublicReview[] };

// Gym Hub › a gym › See all reviews (Gym Profile phase 4, 2026-11-09): every review of the branch,
// newest change first, 20 at a time. Hidden words arrive empty and read "Rating only"; the stars
// count in the summary. Writing or changing the member's own review is on the gym's page.
export default function GymReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [result, setResult] = useState<Load>({ state: "loading" });
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    const answer = await discoverApi.reviews(await getToken().catch(() => null), Number(id));
    setResult(answer.ok ? { state: "ready", data: answer.data, list: answer.data.reviews } : { state: "failed", error: answer.error });
  }, [getToken, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const showMore = async () => {
    if (result.state !== "ready" || !result.data.nextPage || more) return;
    setMore(true);
    const answer = await discoverApi.reviews(await getToken().catch(() => null), Number(id), result.data.nextPage);
    setMore(false);
    if (answer.ok) setResult((current) => (current.state === "ready" ? { state: "ready", data: answer.data, list: [...current.list, ...answer.data.reviews.filter((r) => !current.list.some((c) => c.id === r.id))] } : current));
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-hub"));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Reviews" onBack={back} />
        {result.state === "loading" ? (
          <View className="p-4"><ScreenSkeleton cards={3} label="Loading the reviews" /></View>
        ) : result.state === "failed" ? (
          <View className="p-4">
            <View className="card" style={{ gap: 12 }}>
              <FormAlert message={result.error} />
              <PrimaryButton label="Try again" onPress={() => { setResult({ state: "loading" }); load(); }} />
            </View>
          </View>
        ) : (
          <FlatList
            {...listPerf}
            data={result.list}
            keyExtractor={(r) => String(r.id)}
            renderItem={({ item }) => <ReviewCard review={item} />}
            ListHeaderComponent={<ReviewSummaryCard summary={result.data.summary} />}
            ListFooterComponent={result.data.nextPage ? <PrimaryButton label="Show more" onPress={showMore} loading={more} /> : undefined}
            contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
