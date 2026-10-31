import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { appUsage, cohortText, type CohortUnit, type Retention } from "@/lib/appUsage";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: Retention };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/app-usage"));
const units: CohortUnit[] = ["week", "month"];
const UNIT_LABEL: Record<CohortUnit, string> = { week: "By week joined", month: "By month joined" };

// Super Admin › App Usage › Retention: members grouped by when they joined, and what share of
// each group came back on or after day 1, 7 and 30, plus how each group's activity fell away
// week by week (or month by month). A dash means the group is too young for that day yet.
export default function RetentionScreen() {
  const getToken = useSessionToken();
  const [unit, setUnit] = useState<CohortUnit>("week");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async (u: CohortUnit) => {
    const result = await appUsage.retention(await getToken().catch(() => null), u);
    setLoad(result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error });
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      refresh(unit);
    }, [refresh, unit]),
  );
  // A pull reads the grouping that is showing again
  const reload = useCallback(() => refresh(unit), [refresh, unit]);
  const { refreshControl } = usePullToRefresh(reload);

  const pick = (u: CohortUnit) => {
    setUnit(u);
    setLoad({ state: "loading" });
  };
  const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Retention</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          <View className="flex-row rounded-full bg-cream-tab p-1" accessibilityRole="tablist">
            {units.map((u) => (
              <Pressable key={u} onPress={() => pick(u)} className={unit === u ? "admin-segment admin-segment--on" : "admin-segment"} accessibilityRole="tab" accessibilityState={{ selected: unit === u }} accessibilityLabel={UNIT_LABEL[u]}>
                <Text className={unit === u ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{UNIT_LABEL[u]}</Text>
              </Pressable>
            ))}
          </View>

          {load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.forest} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load retention" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(unit); }} />
          ) : load.data.cohorts.length === 0 ? (
            <DashedBlock icon={{ ios: "person.2", android: "group", web: "group" }} title="No members joined in this window" text={unit === "week" ? "Nobody joined in the last 8 weeks." : "Nobody joined in the last 6 months."} />
          ) : (
            <>
              <Text className="home__note">Of the members who joined in each period, the share who did anything in the app on or after that many days later. A dash: too soon to know.</Text>

              <View className="admin-list">
                <View className="admin-row admin-row--divided" style={{ paddingVertical: 8 }}>
                  <Text className="admin-stat__label flex-1">Cohort</Text>
                  <Text className="admin-stat__label" style={{ width: 52, textAlign: "right" }}>Joined</Text>
                  {load.data.days.map((d) => <Text key={d} className="admin-stat__label" style={{ width: 52, textAlign: "right" }}>{`Day ${d}`}</Text>)}
                </View>
                {load.data.cohorts.map((c) => (
                  <View key={c.cohort} className="admin-row admin-row--divided" style={{ paddingVertical: 10 }} accessibilityLabel={`${cohortText(c.cohort, load.data.unit)}: ${c.joined} joined, day 1 ${pct(c.retention.day1)}, day 7 ${pct(c.retention.day7)}, day 30 ${pct(c.retention.day30)}`}>
                    <Text className="ai-kv__key flex-1" numberOfLines={1}>{cohortText(c.cohort, load.data.unit)}</Text>
                    <Text className="ai-kv__value" style={{ width: 52, textAlign: "right" }}>{c.joined}</Text>
                    <Text className="ai-kv__value" style={{ width: 52, textAlign: "right" }}>{pct(c.retention.day1)}</Text>
                    <Text className="ai-kv__value" style={{ width: 52, textAlign: "right" }}>{pct(c.retention.day7)}</Text>
                    <Text className="ai-kv__value" style={{ width: 52, textAlign: "right" }}>{pct(c.retention.day30)}</Text>
                  </View>
                ))}
              </View>

              <Text className="setup__section">{unit === "week" ? "Week by week" : "Month by month"}</Text>
              <View className="admin-list px-4 py-3" style={{ gap: 12 }}>
                <Text className="post__time">{`For each group, the share still active in each later ${unit}. The first bar is the ${unit} they joined.`}</Text>
                {load.data.cohorts.map((c) => (
                  <View key={c.cohort} style={{ gap: 4 }} accessibilityLabel={`${cohortText(c.cohort, load.data.unit)}: ${c.periods.map((p, i) => `${unit} ${i}: ${p}%`).join(", ")}`}>
                    <Text className="ai-kv__key">{cohortText(c.cohort, load.data.unit)}</Text>
                    <View className="flex-row items-end" style={{ gap: 4, height: 36 }}>
                      {c.periods.map((p, i) => (
                        <View key={i} style={{ width: 18, alignItems: "center" }}>
                          <View className="rounded-sm" style={{ width: 14, height: Math.max(2, Math.round((p / 100) * 30)), backgroundColor: p > 0 ? colors.primary : colors.creamTab }} />
                        </View>
                      ))}
                    </View>
                    <Text className="post__time">{c.periods.map((p) => `${p}%`).join(" · ")}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
