import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { aiUsage, inr, type BudgetSettings, type BudgetView } from "@/lib/aiUsage";
import { useSessionToken } from "@/lib/session";
import { useThemeColors, useSwitchColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: BudgetView };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/ai-usage"));
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const switches: { key: keyof Omit<BudgetSettings, "monthlyLimitInr" | "usdToInr">; label: string; note: string }[] = [
  { key: "alert50", label: "Alert at 50%", note: "Half the monthly budget is spent" },
  { key: "alert75", label: "Alert at 75%", note: "Three quarters spent" },
  { key: "alert90", label: "Alert at 90%", note: "Nearly there" },
  { key: "alert100", label: "Alert at 100%", note: "The budget is used up (AI features stay on)" },
  { key: "spikeAlerts", label: "Unexpected increase", note: "A day over ₹100 and more than double the recent daily average" },
];

// Super Admin › AI Usage › Budget & alerts: the monthly limit, how much of it is used, which
// alerts are on, and the alerts that fired (acknowledge to clear them). Reaching the limit only
// alerts: nothing is switched off.
export default function AiBudgetScreen() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [form, setForm] = useState<BudgetSettings | null>(null);
  const [limitText, setLimitText] = useState("");
  const [rateText, setRateText] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [acking, setAcking] = useState<string | null>(null);

  const apply = useCallback((data: BudgetView) => {
    setLoad({ state: "ready", data });
    const { updatedBy: _by, updatedAt: _at, ...settings } = data.settings;
    setForm(settings);
    setLimitText(String(settings.monthlyLimitInr));
    setRateText(String(settings.usdToInr));
  }, []);

  const refresh = useCallback(async () => {
    const result = await aiUsage.budget(await getToken().catch(() => null));
    if (result.ok) apply(result.data);
    else setLoad({ state: "failed", error: result.error });
  }, [getToken, apply]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Whether the settings on screen differ from what was loaded (typed, not yet saved)
  const edited = load.state === "ready" && form !== null && (limitText !== String(load.data.settings.monthlyLimitInr) || rateText !== String(load.data.settings.usdToInr) || switches.some((item) => form[item.key] !== load.data.settings[item.key]));

  // A pull reads the usage and alerts again; the settings form is only replaced when nothing is typed in it
  const reload = useCallback(async () => {
    if (!edited) return refresh();
    const result = await aiUsage.budget(await getToken().catch(() => null));
    if (result.ok) setLoad({ state: "ready", data: result.data });
    else setLoad({ state: "failed", error: result.error });
  }, [edited, refresh, getToken]);
  const { refreshControl } = usePullToRefresh(reload);

  const save = async () => {
    if (!form || saving) return;
    const limit = Number(limitText.replace(/[^0-9.]/g, ""));
    const rate = Number(rateText.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(limit) || limit < 0) return setNote({ tone: "error", text: "Enter the monthly limit in rupees, 0 or more." });
    if (!Number.isFinite(rate) || rate < 1) return setNote({ tone: "error", text: "Enter the exchange rate in rupees per US dollar, 1 or more." });
    setSaving(true);
    setNote(null);
    const result = await aiUsage.saveBudget(await getToken().catch(() => null), { ...form, monthlyLimitInr: limit, usdToInr: rate });
    setSaving(false);
    if (!result.ok) return setNote({ tone: "error", text: result.error });
    apply(result.data);
    setNote({ tone: "ok", text: "Saved." });
  };

  const acknowledge = async (id: string) => {
    if (acking) return;
    setAcking(id);
    const result = await aiUsage.acknowledge(await getToken().catch(() => null), id);
    setAcking(null);
    if (result.ok) apply(result.data);
    else setNote({ tone: "error", text: result.error });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Budget & alerts</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} refreshControl={refreshControl}>
          {load.state === "loading" ? (
            <View className="items-center py-16"><ActivityIndicator color={colors.leaf} /></View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the budget" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : form && (
            <>
              <Utilization data={load.data} />

              <Text className="setup__section">Settings</Text>
              <View className="admin-list px-4 py-3" style={{ gap: 12 }}>
                <Text className="card__title">Monthly AI spending limit (₹)</Text>
                <TextInput
                  className="admin__input"
                  value={limitText}
                  onChangeText={setLimitText}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  placeholder="4000"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Monthly limit"
                />
                <Text className="admin__hint">0 turns the threshold alerts off.</Text>
                <Text className="card__title">Exchange rate (₹ per US dollar)</Text>
                <TextInput
                  className="admin__input"
                  value={rateText}
                  onChangeText={setRateText}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  placeholder="84"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Exchange rate"
                />
                <Text className="admin__hint">OpenAI bills in US dollars; each new call is converted to rupees at this rate when it is recorded. Earlier rows keep the rate they were recorded at.</Text>
                {switches.map((item) => (
                  <View key={item.key} className="flex-row items-center gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="card__title">{item.label}</Text>
                      <Text className="meta-text">{item.note}</Text>
                    </View>
                    <Switch {...switchColors} value={form[item.key]} onValueChange={(value) => setForm({ ...form, [item.key]: value })} disabled={saving} accessibilityLabel={item.label} />
                  </View>
                ))}
                {note && <Text className={note.tone === "ok" ? "admin__success" : "macro__error"} accessibilityRole={note.tone === "ok" ? undefined : "alert"}>{note.text}</Text>}
                <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Save budget" accessibilityState={{ busy: saving }}>
                  {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Save</Text>}
                </Pressable>
                {load.data.settings.updatedAt && (
                  <Text className="meta-text">{`Last changed ${load.data.settings.updatedBy ? `by ${load.data.settings.updatedBy} ` : ""}on ${when(load.data.settings.updatedAt)}`}</Text>
                )}
              </View>

              <Text className="setup__section">Alerts</Text>
              {load.data.alerts.length === 0 ? (
                <DashedBlock icon={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} title="No alerts" text="Threshold and spike alerts show up here when they fire." />
              ) : (
                <View className="admin-list">
                  {load.data.alerts.map((alert, i) => (
                    <View key={alert.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} style={{ opacity: alert.acknowledgedAt ? 0.55 : 1 }}>
                      <View className="admin-row__icon">
                        <SymbolView
                          name={alert.kind === "spike" ? { ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" } : { ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
                          size={18}
                          tintColor={alert.acknowledgedAt ? colors.muted : colors.danger}
                        />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="type-body text-forest-ink">{alert.detail}</Text>
                        <Text className="meta-text">{alert.acknowledgedAt ? `${when(alert.at)} · acknowledged` : when(alert.at)}</Text>
                      </View>
                      {!alert.acknowledgedAt && (
                        <Pressable onPress={() => acknowledge(alert.id)} disabled={acking !== null} className="btn-outline px-4" accessibilityRole="button" accessibilityLabel={`Acknowledge: ${alert.detail}`}>
                          {acking === alert.id ? <ActivityIndicator color={colors.forestInk} /> : <Text className="btn-outline__label">Acknowledge</Text>}
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Utilization({ data }: { data: BudgetView }) {
  const { month } = data;
  const over = month.percent >= 100;
  const warn = month.percent >= 75;
  return (
    <View className={`admin-stat grow-0 basis-auto ${over ? "admin-stat--danger" : warn ? "admin-stat--warning" : ""}`} accessibilityLabel={`Budget used this month: ${inr(month.spentInr)} of ${inr(month.monthlyLimitInr)}, ${month.percent}%. Remaining budget ${inr(month.remainingInr)}`}>
      <View className="flex-row items-center justify-between">
        <Text className="card__title">Budget used this month</Text>
        <Text className="admin-stat__label">{month.monthlyLimitInr > 0 ? `${month.percent}% used` : "No limit set"}</Text>
      </View>
      <View className="ai-bar mt-1">
        <View className={over ? "ai-bar__fill ai-bar__fill--danger" : warn ? "ai-bar__fill ai-bar__fill--warning" : "ai-bar__fill"} style={{ width: `${Math.min(month.percent, 100)}%` }} />
      </View>
      <View className="mt-2 flex-row justify-between">
        {[["Spent this month", inr(month.spentInr)], ["Monthly budget", inr(month.monthlyLimitInr)], ["Remaining budget", inr(month.remainingInr)]].map(([label, value]) => (
          <View key={label}>
            <Text className="admin-stat__label">{label}</Text>
            <Text className="ai-money">{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
