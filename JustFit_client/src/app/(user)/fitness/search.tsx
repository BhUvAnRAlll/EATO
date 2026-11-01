import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { IconButton } from "@/components/IconButton";
import { PressableScale } from "@/components/PressableScale";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SECTION_TITLE } from "@/lib/fitness/catalog";
import { fitnessApi, LEVEL_TEXT, programMeta, type ProgramCardData } from "@/lib/fitnessApi";
import { useSessionToken } from "@/lib/session";
import type { Place } from "@/lib/workoutApi";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/workout"));
const SUGGESTIONS = ["Yoga", "Beginners", "Dance", "Strength", "Cardio", "Workplace"];

// Search the Fitness tab: programs and categories (a category name finds its programs), at home
// or the center. Results update a moment after typing stops; each opens its program.
export default function FitnessSearchScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const params = useLocalSearchParams<{ place?: string }>();
  const [place, setPlace] = useState<Place>(params.place === "center" ? "center" : "home");
  const [typed, setTyped] = useState("");
  const [results, setResults] = useState<ProgramCardData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const search = useCallback(async (q: string, where: Place) => {
    const request = ++latest.current;
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await fitnessApi.programs(await getToken().catch(() => null), where, q);
    if (request !== latest.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return setResults([]);
    }
    setError(null);
    setResults(result.data.sections.flatMap((s) => s.programs));
  }, [getToken]);

  // The search runs a moment after typing stops, and again when the place changes
  useEffect(() => {
    const t = setTimeout(() => search(typed.trim(), place), 300);
    return () => clearTimeout(t);
  }, [typed, place, search]);

  const open = (p: ProgramCardData) => router.push({ pathname: "/fitness/[id]", params: { id: p.id } });

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="fitness-header">
          <View className="flex-row items-center gap-2">
            <IconButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={back} />
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder="Search programs and categories"
              placeholderTextColor={colors.faint}
              className="admin__input flex-1"
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search programs and categories"
            />
          </View>
          <View className="flex-row gap-2">
            {(["home", "center"] as Place[]).map((p) => (
              <Pressable key={p} onPress={() => setPlace(p)} className={place === p ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: place === p }}>
                <Text className={place === p ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{p === "home" ? "At home" : "At center"}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {results === null ? (
          <View className="gap-3 px-4 pt-2">
            <Text className="setup__section">Try</Text>
            <View className="flex-row flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => setTyped(s)} className="admin-chip" accessibilityRole="button" accessibilityLabel={`Search ${s}`}>
                  <Text className="admin-segment__label">{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : loading && results.length === 0 ? (
          <View className="items-center py-16"><ActivityIndicator color={colors.leaf} /></View>
        ) : results.length === 0 ? (
          <View className="px-4 pt-2">
            <DashedBlock icon={{ ios: "magnifyingglass", android: "search", web: "search" }} title={error ? "Search isn't working right now" : "No programs found"} text={error ?? `Nothing matches "${typed.trim()}" ${place === "home" ? "at home" : "at the center"}. Try another word or place.`} />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            renderItem={({ item }) => (
              <PressableScale onPress={() => open(item)} scaleTo={0.98} className="program-card" accessibilityRole="button" accessibilityLabel={`${item.title}, ${SECTION_TITLE[item.section]}. ${programMeta(item)}. Open`}>
                <View className="program-card__thumb overflow-hidden">
                  <ProgramArt palette={item.palette} icon={item.icon} iconSize={22} id={`search-${item.id}`} />
                </View>
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="program-card__title" numberOfLines={1}>{item.title}</Text>
                  <Text className="program-card__meta" numberOfLines={1}>{`${SECTION_TITLE[item.section]} · ${LEVEL_TEXT[item.level]}`}</Text>
                  <Text className="program-card__meta" numberOfLines={1}>{programMeta(item)}</Text>
                </View>
              </PressableScale>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
