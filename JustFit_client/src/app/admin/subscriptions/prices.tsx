import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { AdminField } from "@/components/admin/AdminField";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { FormAlert } from "@/components/FormAlert";
import { LoadError } from "@/components/macro/LoadError";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { subscriptionsApi, type LengthInput } from "@/lib/subscriptionsApi";
import { useGymData } from "@/lib/useGymData";
import { useSwitchColors, useThemeColors } from "@/theme";

type Row = { label: string; days: string; percentOff: string; active: boolean };
const MAX_LENGTHS = 6;

// Super Admin › Subscriptions › Prices (2026-11-10, the user's choice: one table for every meal):
// the lengths members can subscribe a meal for (a name, delivery days, % off, shown), 1 to 6 of them.
// A member pays the meal's menu price × how many a day × the days, less the % off; subscriptions
// already bought keep what they were bought at.
export default function SubscriptionPrices() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const { result, retry, refresh } = useGymData(subscriptionsApi.adminLengths);
  // The admin's edits; until the first one, the rows are what the server holds
  const [edited, setRows] = useState<Row[] | null>(null);
  const saved = result.state === "ready" ? result.data.lengths.map((l) => ({ label: l.label, days: String(l.days), percentOff: String(l.percentOff), active: l.active })) : null;
  const rows = edited ?? saved;
  const [problem, setProblem] = useState("");
  const { busy, error, save } = useGymSave<{ lengths: LengthInput[] }>(() => {
    setRows(null);
    refresh();
  }, "Prices saved");

  const change = (i: number, patch: Partial<Row>) => setRows((rows ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = () => {
    if (!rows) return;
    const lengths = rows.map((r) => ({ label: r.label.trim(), days: Number(r.days), percentOff: Number(r.percentOff || 0), active: r.active }));
    if (lengths.some((l) => !Number.isInteger(l.days) || l.days < 1 || l.days > 90)) return setProblem("Delivery days must be whole numbers from 1 to 90.");
    if (lengths.some((l) => !Number.isInteger(l.percentOff) || l.percentOff < 0 || l.percentOff > 50)) return setProblem("The % off must be a whole number from 0 to 50.");
    setProblem("");
    save((t) => subscriptionsApi.saveLengths(t, lengths));
  };

  return (
    <AdminScreen title="Subscription prices" subtitle="Lengths and % off for every meal" onRefresh={refresh}>
      {result.state === "loading" && <ScreenSkeleton label="Loading the prices" />}
      {result.state === "failed" && <LoadError title="The prices couldn't load" message={result.error} onRetry={retry} />}
      {rows && (
        <View style={{ gap: 14 }}>
          <Text className="meta-text">{"A member pays the meal's price × how many a day × the delivery days, less the % off. Changes apply to new subscriptions."}</Text>
          {rows.map((r, i) => (
            <View key={i} className="card" style={{ gap: 12, opacity: r.active ? 1 : 0.75 }}>
              <View className="flex-row items-center" style={{ gap: 10 }}>
                <Text className="type-headline text-forest-ink flex-1">{r.label || "New length"}</Text>
                <Switch value={r.active} onValueChange={(v) => change(i, { active: v })} {...switchColors} accessibilityLabel={`Show ${r.label || "this length"} to members`} />
                {rows.length > 1 ? (
                  <Pressable onPress={() => setRows(rows.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${r.label || "this length"}`}>
                    <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={18} tintColor={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
              <AdminField label="Name" value={r.label} onChangeText={(v) => change(i, { label: v })} placeholder="1 Month" maxLength={20} />
              <View className="flex-row" style={{ gap: 10 }}>
                <View className="flex-1"><AdminField label="Delivery days" value={r.days} onChangeText={(v) => change(i, { days: v.replace(/[^0-9]/g, "") })} keyboardType="number-pad" maxLength={2} /></View>
                <View className="flex-1"><AdminField label="% off" value={r.percentOff} onChangeText={(v) => change(i, { percentOff: v.replace(/[^0-9]/g, "") })} keyboardType="number-pad" maxLength={2} /></View>
              </View>
            </View>
          ))}
          {rows.length < MAX_LENGTHS ? (
            <Pressable onPress={() => setRows([...rows, { label: "", days: "", percentOff: "0", active: true }])} className="admin-chip flex-row self-start" style={{ gap: 6 }} accessibilityRole="button">
              <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
              <Text className="admin-segment__label admin-segment__label--on">Add a length</Text>
            </Pressable>
          ) : null}
          {problem || error ? <FormAlert message={problem || error} /> : null}
          <PrimaryButton label={busy ? "Saving…" : "Save prices"} onPress={submit} disabled={busy} />
        </View>
      )}
    </AdminScreen>
  );
}
