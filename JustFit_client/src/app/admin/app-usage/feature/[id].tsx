import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { BarChart } from "@/components/admin/BarChart";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { MODULE_ICON } from "@/data/appUsage";
import { appUsage, changeText, rangeText, RANGE_LABEL, type FeatureDetail, type UsageRange } from "@/lib/appUsage";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: FeatureDetail };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/app-usage"));
const ranges: UsageRange[] = ["7d", "30d", "90d"];

// Super Admin › App Usage › one feature: its uses and members for a range against the range
// before, a per-day chart, and the members who used it most (admins only).
export default function FeatureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [range, setRange] = useState<UsageRange>("30d");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async (r: UsageRange) => {
    if (!id) return;
    const result = await appUsage.feature(await getToken().catch(() => null), id, { range: r });
    setLoad(result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error });
  }, [getToken, id]);

  useFocusEffect(
    useCallback(() => {
      refresh(range);
    }, [refresh, range]),
  );

  const pick = (r: UsageRange) => { setRange(r); setLoad({ state: "loading" }); };
  const title = load.state === "ready" ? load.data.feature.label : "Feature";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header" numberOfLines={1}>{title}</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false}>
          <View className="flex-row rounded-full bg-cream-tab p-1" accessibilityRole="tablist">
            {ranges.map((r) => (
              <Pressable key={r} onPress={() => pick(r)} className={range === r ? "admin-segment admin-segment--on" : "admin-segment"} accessibilityRole="tab" accessibilityState={{ selected: range === r }} accessibilityLabel={RANGE_LABEL[r]}>
                <Text className={range === r ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{RANGE_LABEL[r]}</Text>
              </Pressable>
            ))}
          </View>

          {load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.forest} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load this feature" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(range); }} />
          ) : !load.data.tracked || !load.data.current || !load.data.previous || !load.data.series ? (
            <DashedBlock icon={MODULE_ICON[load.data.feature.module]} title="Not tracked on this server yet" text="The table this feature is counted from hasn't been set up here." />
          ) : (
            <Ready data={load.data} />
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Ready({ data }: { data: FeatureDetail }) {
  const current = data.current!;
  const previous = data.previous!;
  const series = data.series!;
  const before = `the ${data.range.days} days before`;
  const perMember = current.members > 0 ? Math.round((current.uses / current.members) * 10) / 10 : 0;
  const every = data.range.days <= 7 ? 1 : data.range.days <= 31 ? 5 : 15;
  const label = (key: string, i: number) => (i % every === 0 || i === data.range.days - 1 ? key.slice(8) : "");
  return (
    <>
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <View className="admin-row__icon"><SymbolView name={MODULE_ICON[data.feature.module]} size={18} tintColor={colors.forestInk} /></View>
        <Text className="home__note flex-1">{`${rangeText(data.range.from, data.range.to)} · compared with ${rangeText(data.range.previousFrom, data.range.previousTo)}`}</Text>
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        <View className="admin-stat" style={{ flexBasis: "46%" }} accessibilityLabel={`Members: ${current.members}, ${changeText(data.changePercent ?? null)} vs ${before}`}>
          <Text className="admin-stat__label">Members</Text>
          <Text className="admin-stat__value">{current.members}</Text>
          <Text className="admin-stat__label" numberOfLines={2}>{`${changeText(data.changePercent ?? null)} vs ${before} (${previous.members})`}</Text>
        </View>
        <View className="admin-stat" style={{ flexBasis: "46%" }} accessibilityLabel={`Uses: ${current.uses}, ${perMember} per member`}>
          <Text className="admin-stat__label">Uses</Text>
          <Text className="admin-stat__value">{current.uses.toLocaleString("en-IN")}</Text>
          <Text className="admin-stat__label" numberOfLines={2}>{`${perMember} per member · ${previous.uses} before`}</Text>
        </View>
      </View>

      <View className="admin-list px-4 py-3" style={{ gap: 14 }}>
        <Text className="card__title">Members per day</Text>
        <BarChart points={series.map((p) => ({ key: p.key, value: p.members }))} format={(v) => `${v} ${v === 1 ? "member" : "members"}`} label={label} color={colors.primary} />
        <Text className="card__title">Uses per day</Text>
        <BarChart points={series.map((p) => ({ key: p.key, value: p.uses }))} format={(v) => `${v} uses`} label={label} color={colors.accentBlue} />
      </View>

      <Text className="setup__section">Used most by</Text>
      <View className="admin-list">
        {(data.topMembers ?? []).length === 0 ? (
          <Text className="post__time px-4 py-3">Nobody in this range.</Text>
        ) : (
          data.topMembers!.map((m, i) => (
            <View key={m.id} className={i > 0 ? "admin-row admin-row--divided" : "admin-row"} accessibilityLabel={`${m.name}: ${m.uses} uses`}>
              <Text className="card__title min-w-0 flex-1" numberOfLines={1}>{m.name}</Text>
              <Text className="ai-kv__value">{`${m.uses} ${m.uses === 1 ? "use" : "uses"}`}</Text>
            </View>
          ))
        )}
      </View>
    </>
  );
}
