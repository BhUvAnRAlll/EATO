import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { AdminField } from "@/components/admin/AdminField";
import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { MEAL_SLOTS, SLOT_LABEL, clockText, closesAtText, dayLabel, shiftTime, type MealSlot } from "@/lib/mealRules";
import { todayIso } from "@/lib/macro";
import { kitchenApi, type Slots } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useSwitchColors, useThemeColors } from "@/theme";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals"));
const CUTOFF_MINUTES = 120; // the server's rule: orders close 2 hours before the meal time starts

// Super Admin › Meals › Delivery times: when breakfast, lunch and dinner are delivered, each on or
// off. Times move in half hours. Members can order a meal time until 2 hours before it starts; a
// change applies to new orders, never to ones already placed. Since phase 3: each meal time's
// orders a day across justFit (empty = no limit; booked up, members can't pick it), and holidays
// (no deliveries that day; members see the note).
export default function AdminDeliveryTimes() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const { result, retry } = useGymData(kitchenApi.slots);
  // The admin's changes; until the first one, the saved times
  const [edits, setSlots] = useState<Slots | null>(null);
  const slots = edits ?? (result.state === "ready" ? result.data.slots : null);
  const { busy, error, save } = useGymSave(() => back(), "Delivery times saved");

  const change = (slot: MealSlot, field: "startsAt" | "endsAt", minutes: number) =>
    slots && setSlots({ ...slots, [slot]: { ...slots[slot], [field]: shiftTime(slots[slot][field], minutes) } });
  const problem = slots ? MEAL_SLOTS.find((s) => slots[s].startsAt >= slots[s].endsAt || slots[s].capacity === 0) : undefined;

  const stepper = (slot: MealSlot, field: "startsAt" | "endsAt", label: string) => (
    <View className="flex-1" style={{ gap: 6 }}>
      <Text className="auth__label">{label}</Text>
      <View className="flex-row items-center justify-between rounded-md" style={{ backgroundColor: colors.creamDeep, padding: 4 }}>
        <Pressable onPress={() => change(slot, field, -30)} hitSlop={6} className="admin-row__icon" style={{ backgroundColor: colors.surface }} accessibilityRole="button" accessibilityLabel={`${SLOT_LABEL[slot]} ${label.toLowerCase()} 30 minutes earlier`}>
          <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={16} tintColor={colors.ink} />
        </Pressable>
        <Text className="card__title">{clockText(slots![slot][field])}</Text>
        <Pressable onPress={() => change(slot, field, 30)} hitSlop={6} className="admin-row__icon" style={{ backgroundColor: colors.surface }} accessibilityRole="button" accessibilityLabel={`${SLOT_LABEL[slot]} ${label.toLowerCase()} 30 minutes later`}>
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.ink} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Delivery times" onBack={back} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}>
          {result.state === "loading" && <ScreenSkeleton label="Loading delivery times" />}
          {result.state === "failed" && (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the times" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
          )}
          {slots && (
            <>
              <Text className="meta-text">Members can order a meal time until 2 hours before it starts. New times apply to new orders.</Text>
              {MEAL_SLOTS.map((slot) => {
                const s = slots[slot];
                return (
                  <View key={slot} className="card" style={{ gap: 12, opacity: s.active ? 1 : 0.75 }}>
                    <View className="flex-row items-center">
                      <View className="flex-1">
                        <Text className="type-headline text-forest-ink">{SLOT_LABEL[slot]}</Text>
                        <Text className="meta-text">{s.active ? `Orders close at ${closesAtText(s.startsAt, CUTOFF_MINUTES)}` : "Not delivered: members can't pick it"}</Text>
                      </View>
                      <Switch
                        value={s.active}
                        onValueChange={(on) => setSlots({ ...slots, [slot]: { ...s, active: on } })}
                        {...switchColors}
                        accessibilityLabel={`Deliver ${SLOT_LABEL[slot].toLowerCase()}`}
                      />
                    </View>
                    {s.active && (
                      <View className="flex-row" style={{ gap: 10 }}>
                        {stepper(slot, "startsAt", "From")}
                        {stepper(slot, "endsAt", "To")}
                      </View>
                    )}
                    {s.active && (
                      <AdminField
                        label="Orders a day (optional)"
                        value={s.capacity == null ? "" : String(s.capacity)}
                        onChangeText={(t) => {
                          const digits = t.replace(/[^0-9]/g, "").slice(0, 5);
                          setSlots({ ...slots, [slot]: { ...s, capacity: digits === "" ? null : Number(digits) } });
                        }}
                        keyboardType="number-pad"
                        placeholder="No limit"
                        hint="Once this many are booked for a day, members can't pick it."
                      />
                    )}
                    {s.startsAt >= s.endsAt && <Text className="admin__hint" style={{ color: colors.danger }}>The end must be after the start.</Text>}
                  </View>
                );
              })}
              {error ? <FormAlert message={error} /> : null}
              <Pressable onPress={() => slots && !problem && save((token) => kitchenApi.saveSlots(token, slots))} disabled={busy || !!problem} className={problem ? "btn-forest btn--disabled" : "btn-forest"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button">
                {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
                <Text className={problem ? "btn-forest__label btn--disabled-label" : "btn-forest__label"}>Save times</Text>
              </Pressable>
              <Holidays />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// No deliveries on these days (a festival, a strike): members can't order for them and see the note
function Holidays() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const load = useCallback((token: string | null) => kitchenApi.holidays(token), []);
  const { result, update } = useGymData(load);
  const [day, setDay] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const today = todayIso();
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today && note.trim().length >= 3;
  const add = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const answer = await kitchenApi.addHoliday(await getToken(), day, note.trim());
    setBusy(false);
    if (!answer.ok) return hud.error(answer.error);
    update(() => answer.data);
    setDay("");
    setNote("");
    hud.success("Holiday added");
  };
  const remove = async (d: string) => {
    const answer = await kitchenApi.removeHoliday(await getToken(), d);
    if (!answer.ok) return hud.error(answer.error);
    update(() => answer.data);
    hud.success("Deliveries back on");
  };
  if (result.state === "failed") return <Text className="meta-text">{result.error}</Text>;
  return (
    <View className="card" style={{ gap: 10 }}>
      <Text className="type-headline text-forest-ink">Holidays</Text>
      <Text className="meta-text">No deliveries on these days. Members see the note.</Text>
      {result.state === "ready" && result.data.holidays.length === 0 ? <Text className="meta-text">None coming up.</Text> : null}
      {result.state === "ready" && result.data.holidays.map((h) => (
        <View key={h.day} className="flex-row items-center" style={{ gap: 8 }}>
          <Text className="type-body text-forest-ink flex-1">{`${dayLabel(h.day, today)} · ${h.note}`}</Text>
          <Pressable onPress={() => remove(h.day)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove the holiday on ${h.day}`}>
            <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={16} tintColor={colors.danger} />
          </Pressable>
        </View>
      ))}
      <View className="flex-row" style={{ gap: 10 }}>
        <View className="flex-1"><AdminField label="Day" value={day} onChangeText={(t) => setDay(t.replace(/[^0-9-]/g, "").slice(0, 10))} placeholder={today} keyboardType="numbers-and-punctuation" /></View>
        <View className="flex-1"><AdminField label="Note" value={note} onChangeText={setNote} maxLength={80} placeholder="Diwali" /></View>
      </View>
      <Pressable onPress={add} disabled={!ready || busy} className={ready ? "admin-chip admin-chip--on self-start" : "admin-chip self-start"} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color={colors.leaf} /> : <Text className={ready ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>Add holiday</Text>}
      </Pressable>
    </View>
  );
}
