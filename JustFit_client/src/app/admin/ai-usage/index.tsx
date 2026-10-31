import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { BarChart } from "@/components/admin/BarChart";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { AI_SECTIONS, FEATURE_LABEL, FEATURE_SHORT, PERIOD_LABEL, PERIOD_PREVIOUS, PROVIDER_LABEL } from "@/data/aiUsage";
import { aiUsage, changeLabel, compact, inr, type AiSummary, type FeatureTotals, type Period } from "@/lib/aiUsage";
import { mergeModels } from "@/lib/aiUsageRules";
import { dateOf } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: AiSummary };

const periods: Period[] = ["day", "week", "month"];
const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/profile"));

// Super Admin › AI Usage: what the AI features cost. All-time cards, the monthly budget, then a
// period (today, 7 or 30 days) with its charts, the breakdowns by feature and model, and one
// section per AI area. Everything comes from one summary call; the history has its own screen.
export default function AiUsageScreen() {
  const getToken = useSessionToken();
  const [period, setPeriod] = useState<Period>("week");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async (p: Period) => {
    const result = await aiUsage.summary(await getToken().catch(() => null), p);
    setLoad(result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error });
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      refresh(period);
    }, [refresh, period]),
  );
  // A pull reads the period that is showing again
  const reload = useCallback(() => refresh(period), [refresh, period]);
  const { refreshControl } = usePullToRefresh(reload);

  const pick = (p: Period) => {
    setPeriod(p);
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
          <Text className="screen-bar__title" accessibilityRole="header">AI Usage</Text>
          <Pressable onPress={() => router.push("/admin/ai-usage/budget")} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Budget and alerts">
            <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={20} tintColor={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          {load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.forest} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock
              icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
              title="Could not load AI usage"
              text={`${load.error.replace(/\.$/, "")}. Tap to try again.`}
              onPress={() => { setLoad({ state: "loading" }); refresh(period); }}
            />
          ) : (
            <Ready data={load.data} period={period} onPeriod={pick} />
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Ready({ data, period, onPeriod }: { data: AiSummary; period: Period; onPeriod: (p: Period) => void }) {
  const { allTime, today, month, current, previous, budget } = data;
  const cards: { label: string; value: string; icon: Icon }[] = [
    { label: "Total AI requests", value: allTime.requests.toLocaleString("en-US"), icon: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" } },
    { label: "Total AI cost", value: inr(allTime.costInr), icon: { ios: "indianrupeesign.circle", android: "currency_rupee", web: "currency_rupee" } },
    { label: "Today's cost", value: inr(today.costInr), icon: { ios: "sun.max", android: "wb_sunny", web: "wb_sunny" } },
    { label: "Cost this month", value: inr(month.costInr), icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" } },
    { label: "Total tokens", value: compact(allTime.tokens), icon: { ios: "text.word.spacing", android: "data_object", web: "data_object" } },
    { label: "Avg cost / request", value: inr(allTime.avgCostInr), icon: { ios: "divide.circle", android: "calculate", web: "calculate" } },
    { label: "Cached input tokens", value: compact(allTime.cachedInputTokens), icon: { ios: "bolt.horizontal.circle", android: "cached", web: "cached" } },
    { label: "Answered from cache", value: allTime.fromCache.toLocaleString("en-US"), icon: { ios: "arrow.counterclockwise.circle", android: "history", web: "history" } },
  ];
  const over = budget.percent >= 100;
  const warn = budget.percent >= 75;
  const totalCost = current.costInr;
  const compare: { label: string; now: string; change: string | null }[] = [
    { label: "Requests", now: current.requests.toLocaleString("en-US"), change: changeLabel(current.requests, previous.requests) },
    { label: "Cost", now: inr(current.costInr), change: changeLabel(current.costInr, previous.costInr) },
    { label: "Tokens", now: compact(current.tokens), change: changeLabel(current.tokens, previous.tokens) },
  ];
  const featureOf = (id: FeatureTotals["feature"]) => data.features.find((f) => f.feature === id) ?? null;

  return (
    <>
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {cards.map((card) => (
          <View key={card.label} className="admin-stat" accessibilityLabel={`${card.label}: ${card.value}`}>
            <SymbolView name={card.icon} size={18} tintColor={colors.forestInk} />
            <Text className="admin-stat__label" numberOfLines={2}>{card.label}</Text>
            <Text className="ai-money" numberOfLines={1} adjustsFontSizeToFit>{card.value}</Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => router.push("/admin/ai-usage/budget")}
        className={`admin-stat grow-0 basis-auto ${over ? "admin-stat--danger" : warn ? "admin-stat--warning" : ""}`}
        accessibilityRole="button"
        accessibilityLabel={`Monthly budget: ${inr(budget.spentInr)} of ${inr(budget.monthlyLimitInr)} spent, ${budget.percent}%. Remaining budget ${inr(budget.remainingInr)}${budget.openAlerts ? `, ${budget.openAlerts} open alerts` : ""}`}
      >
        <View className="flex-row items-center justify-between">
          <Text className="card__title">Monthly budget</Text>
          <Text className="admin-stat__label">{budget.monthlyLimitInr > 0 ? `${budget.percent}% used` : "No limit set"}</Text>
        </View>
        <View className="ai-bar mt-1">
          <View className={over ? "ai-bar__fill ai-bar__fill--danger" : warn ? "ai-bar__fill ai-bar__fill--warning" : "ai-bar__fill"} style={{ width: `${Math.min(budget.percent, 100)}%` }} />
        </View>
        <View className="ai-kv mt-1">
          <Text className="ai-kv__key">{`Spent ${inr(budget.spentInr)} of ${inr(budget.monthlyLimitInr)}`}</Text>
          <Text className="ai-kv__value">{`Remaining budget ${inr(budget.remainingInr)}`}</Text>
        </View>
        <View className="ai-kv">
          <Text className="ai-kv__key">Alerts</Text>
          <Text className="ai-kv__value">{budget.openAlerts > 0 ? `${budget.openAlerts} open ${budget.openAlerts === 1 ? "alert" : "alerts"}` : "None open"}</Text>
        </View>
      </Pressable>

      <View className="flex-row rounded-full bg-cream-tab p-1" accessibilityRole="tablist">
        {periods.map((p) => (
          <Pressable key={p} onPress={() => onPeriod(p)} className={period === p ? "admin-segment admin-segment--on" : "admin-segment"} accessibilityRole="tab" accessibilityState={{ selected: period === p }} accessibilityLabel={PERIOD_LABEL[p]}>
            <Text className={period === p ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{PERIOD_LABEL[p]}</Text>
          </Pressable>
        ))}
      </View>

      <View className="admin-list px-4 py-3" style={{ gap: 10 }}>
        <Text className="card__title">{period === "day" ? "Today" : `Last ${PERIOD_LABEL[period]}`}</Text>
        {compare.map((row) => (
          <View key={row.label} className="ai-kv" accessibilityLabel={`${row.label}: ${row.now}, ${compared(row.change, period)}`}>
            <Text className="ai-kv__key">{row.label}</Text>
            <Text className="ai-kv__value">
              {row.now}
              <Text className="ai-kv__key">{`  ${compared(row.change, period)}`}</Text>
            </Text>
          </View>
        ))}
      </View>

      <View className="admin-list px-4 py-3" style={{ gap: 14 }}>
        <Text className="card__title">Cost trend</Text>
        <BarChart points={data.series.map((p) => ({ key: p.key, value: p.costInr }))} format={inr} label={axisLabel(period)} color={colors.accentBlue} />
        <Text className="card__title">Tokens</Text>
        <BarChart points={data.series.map((p) => ({ key: p.key, value: p.tokens }))} format={compact} label={axisLabel(period)} color={colors.iconLavender} />
      </View>

      <Text className="setup__section">By feature</Text>
      <View className="admin-list px-4 py-3" style={{ gap: 10 }}>
        {data.features.length === 0 ? (
          <Text className="post__time">No AI calls in this period.</Text>
        ) : (
          [...data.features].sort((a, b) => b.costInr - a.costInr).map((f) => (
            <View key={f.feature} style={{ gap: 4 }} accessibilityLabel={`${FEATURE_SHORT[f.feature]}: ${inr(f.costInr)}, ${f.requests} requests, ${inr(f.avgCostInr)} per call`}>
              <View className="ai-kv">
                <Text className="ai-kv__key">{FEATURE_SHORT[f.feature]}</Text>
                <Text className="ai-kv__value">{`${inr(f.costInr)} · ${f.requests} req · ${inr(f.avgCostInr)}/call`}</Text>
              </View>
              <View className="ai-bar"><View className="ai-bar__fill" style={{ width: `${totalCost > 0 ? Math.round((f.costInr / totalCost) * 100) : 0}%` }} /></View>
            </View>
          ))
        )}
      </View>

      <Text className="setup__section">By model</Text>
      <View className="admin-list px-4 py-3" style={{ gap: 10 }}>
        {data.byModel.length === 0 ? (
          <Text className="post__time">No AI calls in this period.</Text>
        ) : (
          data.byModel.map((m) => (
            <View key={`${m.provider}-${m.model}`} className="ai-kv" accessibilityLabel={`${m.model} (${PROVIDER_LABEL[m.provider]}): ${inr(m.costInr)}, ${compact(m.tokens)} tokens, ${m.requests} requests`}>
              <Text className="ai-kv__key">{`${m.model} · ${PROVIDER_LABEL[m.provider]}`}</Text>
              <Text className="ai-kv__value">{`${inr(m.costInr)} · ${compact(m.tokens)} tok · ${m.requests} req`}</Text>
            </View>
          ))
        )}
      </View>

      <Text className="setup__section">Top members</Text>
      <View className="admin-list px-4 py-3" style={{ gap: 10 }}>
        {data.topMembers.length === 0 ? (
          <Text className="post__time">No member AI calls in this period.</Text>
        ) : (
          data.topMembers.map((m) => (
            <View key={m.userId} className="ai-kv" accessibilityLabel={`${m.userName ?? m.userId}: ${inr(m.costInr)}, ${m.requests} requests`}>
              <Text className="ai-kv__key" numberOfLines={1} style={{ flexShrink: 1 }}>{m.userName ?? m.userId}</Text>
              <Text className="ai-kv__value">{`${inr(m.costInr)} · ${m.requests} req`}</Text>
            </View>
          ))
        )}
      </View>

      {AI_SECTIONS.map((section) => {
        const rows = section.features.map((id) => ({ id, totals: featureOf(id) }));
        const models = mergeModels(rows.flatMap((r) => r.totals?.models ?? []));
        const cost = rows.reduce((sum, r) => sum + (r.totals?.costInr ?? 0), 0);
        const requests = rows.reduce((sum, r) => sum + (r.totals?.requests ?? 0), 0);
        return (
          <View key={section.id} style={{ gap: 8 }}>
            <View className="flex-row items-center gap-2">
              <SymbolView name={section.icon} size={16} tintColor={colors.forestInk} />
              <Text className="setup__section">{section.title}</Text>
            </View>
            <View className="admin-list px-4 py-3" style={{ gap: 10 }}>
              <Text className="post__time">{section.note}</Text>
              <View className="ai-kv">
                <Text className="ai-kv__key">Total requests and cost</Text>
                <Text className="ai-kv__value">{`${requests} · ${inr(cost)}`}</Text>
              </View>
              {rows.map(({ id, totals }) => (
                <View key={id} style={{ gap: 2 }}>
                  <View className="ai-kv">
                    <Text className="ai-kv__key">{FEATURE_LABEL[id]}</Text>
                    <Text className="ai-kv__value">{totals ? totals.requests.toLocaleString("en-US") : "0"}</Text>
                  </View>
                  {totals && (
                    <>
                      <View className="ai-kv">
                        <Text className="ai-kv__key">   Successful / failed / refused</Text>
                        <Text className="ai-kv__value">{`${totals.ok} / ${totals.failed} / ${totals.refused}`}</Text>
                      </View>
                      {totals.tokens > 0 && (
                        <View className="ai-kv">
                          <Text className="ai-kv__key">   Tokens in / out / total</Text>
                          <Text className="ai-kv__value">{`${compact(totals.inputTokens)} / ${compact(totals.outputTokens)} / ${compact(totals.tokens)}`}</Text>
                        </View>
                      )}
                      <View className="ai-kv">
                        <Text className="ai-kv__key">   Average cost per call</Text>
                        <Text className="ai-kv__value">{inr(totals.avgCostInr)}</Text>
                      </View>
                      {(totals.cachedInputTokens > 0 || totals.fromCache > 0) && (
                        <View className="ai-kv">
                          <Text className="ai-kv__key">   Cached tokens / answered from cache</Text>
                          <Text className="ai-kv__value">{`${compact(totals.cachedInputTokens)} / ${totals.fromCache}`}</Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              ))}
              {models.length > 0 && (
                <View style={{ gap: 2 }}>
                  <Text className="ai-kv__key">Cost per model</Text>
                  {models.map((m) => (
                    <View key={`${section.id}-${m.model}`} className="ai-kv">
                      <Text className="ai-kv__key">{`   ${m.model}`}</Text>
                      <Text className="ai-kv__value">{`${inr(m.costInr)} · ${m.requests} req`}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        );
      })}

      <View className="admin-list">
        <Pressable onPress={() => router.push("/admin/ai-usage/history")} className="admin-row" accessibilityRole="button" accessibilityLabel="Usage history">
          <View className="admin-row__icon"><SymbolView name={{ ios: "list.bullet.rectangle", android: "table_rows", web: "table_rows" }} size={18} tintColor={colors.forestInk} /></View>
          <View className="min-w-0 flex-1">
            <Text className="card__title">Usage history</Text>
            <Text className="post__time">Every call: who, feature, model, tokens, cost, status</Text>
          </View>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
        </Pressable>
      </View>
    </>
  );
}

// "+25% vs yesterday", or "nothing yesterday" when there is no earlier period to compare with
const compared = (change: string | null, period: Period) =>
  change ? `${change} vs ${PERIOD_PREVIOUS[period].replace(/^in /, "")}` : `nothing ${PERIOD_PREVIOUS[period]}`;

// The x-axis: every 6th hour for a day, weekdays for a week, every 5th date for a month
function axisLabel(period: Period) {
  return (key: string, index: number) => {
    if (period === "day") return index % 6 === 0 ? `${key}h` : "";
    if (period === "week") return dateOf(key).toLocaleDateString("en-GB", { weekday: "narrow" });
    return index % 5 === 0 ? dateOf(key).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  };
}
