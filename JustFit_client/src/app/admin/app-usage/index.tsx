import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { BarChart } from "@/components/admin/BarChart";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { MODULE_ICON, RANK_LIMIT, SCREEN_LABEL } from "@/data/appUsage";
import { appUsage, changeText, durationText, isIsoDate, rangeText, RANGE_LABEL, RANGE_OPTIONS, type FeatureUsage, type UsageQuery, type UsageRange, type UsageSummary } from "@/lib/appUsage";
import { downloadFile } from "@/lib/download";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: UsageSummary };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/profile"));

// Super Admin › App Usage: which features members use, by distinct members (never by raw counts
// alone), for a chosen range with the range before to compare. Members (registered, new, active),
// the active-members trend, the most and least used features, every module, and what isn't
// tracked yet. Everything comes from one call; the numbers are the members' own rows.
export default function AppUsageScreen() {
  const getToken = useSessionToken();
  const [query, setQuery] = useState<UsageQuery>({ range: "7d" });
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  // Export: the same numbers as a CSV file, with the range the screen shows. On a phone the file
  // is written to the app's cache (a share sheet needs expo-sharing, not installed).
  const exportCsv = async (report: "overview" | "features" | "daily" | "members" | "retention") => {
    if (exporting) return;
    setExporting(report);
    setExportNote(null);
    const params = new URLSearchParams({ report, range: query.range });
    if (query.range === "custom" && query.from && query.to) { params.set("from", query.from); params.set("to", query.to); }
    const result = await downloadFile(`/api/admin/portal/usage/export?${params.toString()}`, await getToken().catch(() => null));
    setExporting(null);
    if (!result.ok) {
      if (Platform.OS === "web") setExportNote(result.error);
      else Alert.alert("Couldn't export", result.error);
      return;
    }
    setExportNote(Platform.OS === "web" ? `Saved ${result.where}` : `Saved to the app's files: ${result.where.split("/").pop()}`);
  };

  const refresh = useCallback(async (q: UsageQuery) => {
    const result = await appUsage.summary(await getToken().catch(() => null), q);
    setLoad(result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error });
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      // A custom range only loads once both dates are typed
      if (query.range !== "custom" || (query.from && query.to)) refresh(query);
    }, [refresh, query]),
  );

  const pick = (range: UsageRange) => {
    if (range === "custom") {
      setQuery({ range: "custom", from: isIsoDate(custom.from) ? custom.from : undefined, to: isIsoDate(custom.to) ? custom.to : undefined });
      return;
    }
    setQuery({ range });
    setLoad({ state: "loading" });
  };
  const applyCustom = () => {
    if (!isIsoDate(custom.from) || !isIsoDate(custom.to)) return;
    setQuery({ range: "custom", from: custom.from, to: custom.to });
    setLoad({ state: "loading" });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">App Usage</Text>
          <Pressable onPress={() => exportCsv("features")} disabled={exporting !== null || load.state !== "ready"} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Export features as CSV" accessibilityState={{ disabled: exporting !== null || load.state !== "ready", busy: exporting !== null }}>
            {exporting ? <ActivityIndicator color={colors.ink} /> : <SymbolView name={{ ios: "square.and.arrow.up", android: "ios_share", web: "ios_share" }} size={20} tintColor={colors.ink} />}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* The range: a row of chips that wraps on narrow phones */}
          <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="tablist">
            {RANGE_OPTIONS.map((r) => (
              <Pressable key={r} onPress={() => pick(r)} className={query.range === r ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="tab" accessibilityState={{ selected: query.range === r }} accessibilityLabel={RANGE_LABEL[r]}>
                <Text className={query.range === r ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{RANGE_LABEL[r]}</Text>
              </Pressable>
            ))}
          </View>

          {query.range === "custom" && (
            <View className="admin-list px-4 py-3" style={{ gap: 10 }}>
              <Text className="card__title">Custom range</Text>
              <View className="flex-row" style={{ gap: 10 }}>
                <TextInput value={custom.from} onChangeText={(from) => setCustom((c) => ({ ...c, from }))} placeholder="From (2026-10-01)" placeholderTextColor={colors.faint} className="admin__input flex-1" accessibilityLabel="From date" autoCapitalize="none" autoCorrect={false} onSubmitEditing={applyCustom} />
                <TextInput value={custom.to} onChangeText={(to) => setCustom((c) => ({ ...c, to }))} placeholder="To (2026-10-30)" placeholderTextColor={colors.faint} className="admin__input flex-1" accessibilityLabel="To date" autoCapitalize="none" autoCorrect={false} onSubmitEditing={applyCustom} />
              </View>
              <Pressable onPress={applyCustom} disabled={!isIsoDate(custom.from) || !isIsoDate(custom.to)} className="admin__action admin__action--primary self-start" accessibilityRole="button" accessibilityState={{ disabled: !isIsoDate(custom.from) || !isIsoDate(custom.to) }}>
                <Text className="admin__action-label admin__action-label--primary">Show</Text>
              </Pressable>
              {!(query.from && query.to) && <Text className="admin__hint">Type both dates as year-month-day, up to a year apart.</Text>}
            </View>
          )}

          {query.range === "custom" && !(query.from && query.to) ? null : load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.forest} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock
              icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
              title="Could not load app usage"
              text={`${load.error.replace(/\.$/, "")}. Tap to try again.`}
              onPress={() => { setLoad({ state: "loading" }); refresh(query); }}
            />
          ) : (
            <>
              <Ready data={load.data} />
              <Text className="setup__section">Export</Text>
              <View className="admin-list">
                {([["features", "Features", "Every feature's members, uses and change"], ["overview", "Overview", "The member counts and totals"], ["daily", "Daily", "Active members per day"], ["members", "Members", "Every member's activity"], ["retention", "Retention", "Cohorts and their retention"]] as const).map(([report, title, note], i) => (
                  <Pressable key={report} onPress={() => exportCsv(report)} disabled={exporting !== null} className={i > 0 ? "admin-row admin-row--divided" : "admin-row"} accessibilityRole="button" accessibilityLabel={`Export ${title} as CSV. ${note}`} accessibilityState={{ disabled: exporting !== null }}>
                    <View className="min-w-0 flex-1">
                      <Text className="card__title">{`${title} (CSV)`}</Text>
                      <Text className="post__time">{note}</Text>
                    </View>
                    {exporting === report ? <ActivityIndicator color={colors.ink} /> : <SymbolView name={{ ios: "square.and.arrow.down", android: "download", web: "download" }} size={16} tintColor={colors.faint} />}
                  </Pressable>
                ))}
              </View>
              {exportNote && <Text className="admin__hint" accessibilityRole="alert">{exportNote}</Text>}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Ready({ data }: { data: UsageSummary }) {
  const { members, totals, range } = data;
  const before = range.days === 1 ? "the day before" : `the ${range.days} days before`;
  const cards = [
    { label: "Registered members", value: String(members.registered) },
    { label: "Active in range", value: String(members.active), note: `${members.activePercent}% of members · ${changeText(members.activeChangePercent)} vs ${before}` },
    { label: "New members", value: String(members.newInPeriod) },
    { label: "Feature uses", value: totals.uses.toLocaleString("en-IN"), note: `${totals.usesPerActiveMember} per active member` },
  ];
  const used = data.features.filter((f) => f.members > 0);
  const mostUsed = used.slice(0, RANK_LIMIT);
  // Least used: the fewest members first, declining and unused features included
  const leastUsed = [...data.features].sort((a, b) => a.members - b.members || a.uses - b.uses).slice(0, RANK_LIMIT);
  const daysLabel = (key: string, index: number) => {
    const every = range.days <= 7 ? 1 : range.days <= 31 ? 5 : 15;
    return index % every === 0 || index === range.days - 1 ? key.slice(8) : "";
  };

  return (
    <>
      <Text className="home__note">{`${rangeText(range.from, range.to)} · compared with ${rangeText(range.previousFrom, range.previousTo)}`}</Text>

      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {cards.map((card) => (
          <View key={card.label} className="admin-stat" style={{ flexBasis: "46%" }} accessibilityLabel={`${card.label}: ${card.value}${card.note ? `, ${card.note}` : ""}`}>
            <Text className="admin-stat__label" numberOfLines={2}>{card.label}</Text>
            <Text className="admin-stat__value">{card.value}</Text>
            {card.note && <Text className="admin-stat__label" numberOfLines={3}>{card.note}</Text>}
          </View>
        ))}
      </View>

      <View className="admin-list">
        <Pressable onPress={() => router.push("/admin/app-usage/retention")} className="admin-row" accessibilityRole="button" accessibilityLabel="Retention. Who comes back after joining">
          <View className="admin-row__icon"><SymbolView name={{ ios: "arrow.uturn.backward", android: "replay", web: "replay" }} size={18} tintColor={colors.forestInk} /></View>
          <View className="min-w-0 flex-1">
            <Text className="card__title">Retention</Text>
            <Text className="post__time">Who comes back after joining, by week or month</Text>
          </View>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
        </Pressable>
        <Pressable onPress={() => router.push("/admin/app-usage/members")} className="admin-row admin-row--divided" accessibilityRole="button" accessibilityLabel="Members. Each member's activity">
          <View className="admin-row__icon"><SymbolView name={{ ios: "person.2", android: "group", web: "group" }} size={18} tintColor={colors.forestInk} /></View>
          <View className="min-w-0 flex-1">
            <Text className="card__title">Members</Text>
            <Text className="post__time">Last active, interactions, active days, most-used feature</Text>
          </View>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
        </Pressable>
      </View>

      <View className="admin-list px-4 py-3" style={{ gap: 14 }}>
        <Text className="card__title">Active members per day</Text>
        {members.active === 0 ? (
          <Text className="post__time">Nobody was active in this range.</Text>
        ) : (
          <BarChart points={data.series.map((p) => ({ key: p.key, value: p.members }))} format={(v) => `${v} ${v === 1 ? "member" : "members"}`} label={daysLabel} color={colors.primary} />
        )}
      </View>

      {data.engagement && (
        <>
          <Text className="setup__section">Sessions and screens</Text>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            <View className="admin-stat" style={{ flexBasis: "46%" }} accessibilityLabel={`App sessions: ${data.engagement.sessions.total}, ${data.engagement.sessions.perMember} per member, ${changeText(data.engagement.sessions.changePercent)} vs ${before}`}>
              <Text className="admin-stat__label" numberOfLines={1}>App sessions</Text>
              <Text className="admin-stat__value">{data.engagement.sessions.total.toLocaleString("en-IN")}</Text>
              <Text className="admin-stat__label" numberOfLines={2}>{`${data.engagement.sessions.perMember} per member · ${changeText(data.engagement.sessions.changePercent)} vs ${before}`}</Text>
            </View>
            <View className="admin-stat" style={{ flexBasis: "46%" }} accessibilityLabel={`Average session: ${durationText(data.engagement.sessions.avgSeconds)}`}>
              <Text className="admin-stat__label" numberOfLines={1}>Average session</Text>
              <Text className="admin-stat__value">{durationText(data.engagement.sessions.avgSeconds)}</Text>
              <Text className="admin-stat__label" numberOfLines={2}>from the first to the last thing done in the app</Text>
            </View>
          </View>
          <View className="admin-list px-4 py-3" style={{ gap: 10 }}>
            <Text className="card__title">Screen visits</Text>
            {data.engagement.screens.length === 0 ? (
              <Text className="post__time">No screen views in this range yet.</Text>
            ) : (
              data.engagement.screens.map((sc) => {
                const share = members.active > 0 ? Math.round((sc.members / members.active) * 100) : 0;
                return (
                  <View key={sc.screen} style={{ gap: 4 }} accessibilityLabel={`${SCREEN_LABEL[sc.screen] ?? sc.screen}: ${sc.members} ${sc.members === 1 ? "member" : "members"}, ${sc.visits} visits`}>
                    <View className="ai-kv">
                      <Text className="ai-kv__key">{SCREEN_LABEL[sc.screen] ?? sc.screen}</Text>
                      <Text className="ai-kv__value">{`${sc.members} ${sc.members === 1 ? "member" : "members"} · ${sc.visits.toLocaleString("en-IN")} visits`}</Text>
                    </View>
                    <View className="ai-bar"><View className="ai-bar__fill" style={{ width: `${share}%` }} /></View>
                  </View>
                );
              })
            )}
          </View>
        </>
      )}

      <Text className="setup__section">Most used</Text>
      <View className="admin-list">
        {mostUsed.length === 0 ? (
          <Text className="post__time px-4 py-3">No feature was used in this range.</Text>
        ) : (
          mostUsed.map((f, i) => <FeatureRow key={f.id} feature={f} rank={i + 1} active={members.active} divided={i > 0} />)
        )}
      </View>

      <Text className="setup__section">Least used</Text>
      <View className="admin-list">
        {leastUsed.map((f, i) => <FeatureRow key={f.id} feature={f} active={members.active} divided={i > 0} />)}
      </View>

      <Text className="setup__section">By area</Text>
      {data.modules.map((m) => {
        const features = data.features.filter((f) => m.features.includes(f.id));
        return (
          <View key={m.id} className="admin-list">
            <View className="admin-row" accessibilityLabel={`${m.label}: ${m.members} ${m.members === 1 ? "member" : "members"}, ${m.uses} uses`}>
              <View className="admin-row__icon"><SymbolView name={MODULE_ICON[m.id]} size={18} tintColor={colors.forestInk} /></View>
              <View className="min-w-0 flex-1">
                <Text className="card__title">{m.label}</Text>
                <Text className="post__time">{`${m.members} ${m.members === 1 ? "member" : "members"} · ${m.uses.toLocaleString("en-IN")} uses`}</Text>
              </View>
            </View>
            {features.map((f) => <FeatureRow key={f.id} feature={f} active={members.active} divided compact />)}
          </View>
        );
      })}

      {data.notTracked.length > 0 && (
        <>
          <Text className="setup__section">Not tracked yet</Text>
          <View className="admin-list px-4 py-3" style={{ gap: 6 }}>
            {data.notTracked.map((n) => (
              <Text key={n.id} className="post__time">{`${n.label}: ${n.reason}`}</Text>
            ))}
            <Text className="admin__hint">{"These show here instead of as zero, so \"nobody uses it\" is never confused with \"nothing records it\"."}</Text>
          </View>
        </>
      )}
    </>
  );
}

// One feature: its members (the share bar) and uses, with the change from the range before
function FeatureRow({ feature: f, rank, active, divided, compact = false }: { feature: FeatureUsage; rank?: number; active: number; divided: boolean; compact?: boolean }) {
  const open = () => router.push({ pathname: "/admin/app-usage/feature/[id]", params: { id: f.id } });
  const share = active > 0 ? Math.round((f.members / active) * 100) : 0;
  const trend = f.unused ? "unused" : f.declining ? "declining" : changeText(f.changePercent);
  const trendColor = f.unused || f.declining ? colors.danger : f.changePercent !== null && f.changePercent > 0 ? colors.success : colors.muted;
  const label = `${rank ? `${rank}. ` : ""}${f.label}: ${f.members} ${f.members === 1 ? "member" : "members"} (${share}% of active), ${f.uses} uses, ${f.usesPerMember} per member, ${trend} vs the range before`;
  return (
    <Pressable onPress={open} className={divided ? "admin-row admin-row--divided" : "admin-row"} style={compact ? { paddingVertical: 8 } : undefined} accessibilityRole="button" accessibilityLabel={`${label}. Open details`}>
      <View className="min-w-0 flex-1" style={{ gap: 4 }}>
        <View className="ai-kv">
          <Text className={compact ? "post__time" : "card__title"} numberOfLines={1}>{`${rank ? `${rank}. ` : ""}${f.label}`}</Text>
          <Text className="ai-kv__value">{`${f.members} ${f.members === 1 ? "member" : "members"}`}</Text>
        </View>
        <View className="ai-bar"><View className="ai-bar__fill" style={{ width: `${share}%` }} /></View>
        <View className="ai-kv">
          <Text className="ai-kv__key">{`${f.uses.toLocaleString("en-IN")} uses · ${f.usesPerMember} per member`}</Text>
          <Text className="ai-kv__key" style={{ color: trendColor }}>{trend}</Text>
        </View>
      </View>
    </Pressable>
  );
}
