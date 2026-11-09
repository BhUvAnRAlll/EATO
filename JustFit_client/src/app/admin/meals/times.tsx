import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { MEAL_SLOTS, SLOT_LABEL, clockText, closesAtText, shiftTime, type MealSlot } from "@/lib/mealRules";
import { kitchenApi, type Slots } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useSwitchColors, useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals"));
const CUTOFF_MINUTES = 120; // the server's rule: orders close 2 hours before the meal time starts

// Super Admin › Meals › Delivery times: when breakfast, lunch and dinner are delivered, each on or
// off. Times move in half hours. Members can order a meal time until 2 hours before it starts; a
// change applies to new orders, never to ones already placed.
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
  const problem = slots ? MEAL_SLOTS.find((s) => slots[s].startsAt >= slots[s].endsAt) : undefined;

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
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Delivery times</Text>
          <View className="screen-bar__spacer" />
        </View>
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
                    {s.startsAt >= s.endsAt && <Text className="admin__hint" style={{ color: colors.danger }}>The end must be after the start.</Text>}
                  </View>
                );
              })}
              {error ? <FormAlert message={error} /> : null}
              <Pressable onPress={() => slots && !problem && save((token) => kitchenApi.saveSlots(token, slots))} disabled={busy || !!problem} className={problem ? "btn-forest btn--disabled" : "btn-forest"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button">
                {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
                <Text className={problem ? "btn-forest__label btn--disabled-label" : "btn-forest__label"}>Save times</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
