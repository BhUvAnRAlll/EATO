import { useCallback, useState } from "react";
import { FlatList, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { IconButton } from "@/components/IconButton";
import { ScreenSkeleton } from "@/components/Skeleton";
import { FitnessProgramCard } from "@/components/fitness/FitnessProgramCard";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { fitnessApi, type ProgramCardData, type ProgramSection } from "@/lib/fitnessApi";
import { listPerf } from "@/lib/listPerf";
import { useSessionToken } from "@/lib/session";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; section: ProgramSection | null };

const GUTTER = 16;
const GAP = 12;
const back = () => (router.canGoBack() ? router.back() : router.replace("/workout"));

// A Fitness category's See All: every program in it, at home or the center, as a two-column grid
// of the tab's cards (sized to the screen). Reads the same list the tab does and keeps the one
// section; a category that's hidden or now empty says so. Each card opens its program.
export default function FitnessCategoryScreen() {
  const getToken = useSessionToken();
  const params = useLocalSearchParams<{ id: string; place?: string; title?: string }>();
  const place = params.place === "center" ? "center" : "home";
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((Math.min(width, 600) - GUTTER * 2 - GAP) / 2);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    const result = await fitnessApi.programs(await getToken().catch(() => null), place);
    if (!result.ok) return setLoad({ state: "failed", error: result.error });
    setLoad({ state: "ready", section: result.data.sections.find((s) => s.id === params.id) ?? null });
  }, [getToken, place, params.id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const open = useCallback((p: ProgramCardData) => router.push({ pathname: "/fitness/[id]", params: { id: p.id } }), []);
  const section = load.state === "ready" ? load.section : null;
  // The title shows at once (passed from the tab), then the server's name once loaded
  const title = section?.title ?? params.title ?? "Programs";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="flex-row items-center gap-3 px-4 pb-3 pt-2">
          <IconButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={back} />
          <View className="min-w-0 flex-1">
            <Text className="fitness-section__title" numberOfLines={1} accessibilityRole="header">{title}</Text>
            <Text className="fitness-section__note" numberOfLines={1}>{section?.note ?? (place === "home" ? "At home" : "At the center")}</Text>
          </View>
        </View>
        {load.state === "loading" ? (
          <View className="px-4">
            <ScreenSkeleton cards={2} label="Loading programs" />
          </View>
        ) : load.state === "failed" ? (
          <View className="px-4">
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load programs" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          </View>
        ) : !section || section.programs.length === 0 ? (
          <View className="px-4">
            <DashedBlock icon={{ ios: "figure.walk", android: "directions_walk", web: "directions_walk" }} title="No programs here yet" text={`There's nothing in this category ${place === "home" ? "at home" : "at the center"} right now. Tap to go back.`} onPress={back} />
          </View>
        ) : (
          <FlatList
            {...listPerf}
            data={section.programs}
            keyExtractor={(p) => p.id}
            numColumns={2}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 40, gap: GAP }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => <FitnessProgramCard program={item} variant="tile" width={cardWidth} onOpen={open} />}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
