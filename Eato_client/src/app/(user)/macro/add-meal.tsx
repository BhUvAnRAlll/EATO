import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { MacroHeader } from "@/components/macro/MacroHeader";
import { macro, slotInfo, slots, slotTimes, timeLabel, todayIso, whole, type DayView, type Slot } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { colors } from "@/theme";

// Logging, step one: which meal and what time. Writes nothing; Continue forwards
// { slot, hour, minute } to Log food.
export default function AddMeal() {
  const params = useLocalSearchParams<{ slot?: string }>();
  const getToken = useSessionToken();
  const selectedDate = useMacroStore((state) => state.selectedDate);
  const [slot, setSlot] = useState<Slot>(slots.includes(params.slot as Slot) ? (params.slot as Slot) : "breakfast");
  // null = "Now"
  const [time, setTime] = useState<[number, number] | null>(null);
  const [day, setDay] = useState<DayView | null>(null);

  // Only feeds the "Logged today" badges and the kcal note: the screen works without it
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await macro.day(await getToken().catch(() => null), selectedDate);
        if (!cancelled && result.ok) setDay(result.data);
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken, selectedDate]),
  );

  const pickSlot = (next: Slot) => {
    setSlot(next);
    setTime(null); // a new slot starts back at "Now"
  };

  const continueToLog = () => {
    const now = new Date();
    const [hour, minute] = time ?? (selectedDate === todayIso() ? [now.getHours(), now.getMinutes()] : slotTimes(slot)[0]);
    router.push({ pathname: "/macro/log", params: { slot, hour: String(hour), minute: String(minute) } });
  };

  const loggedSlots = new Set(day?.meals.map((m) => m.slot));
  const remaining = day?.targets ? Math.max(0, day.targets.kcal - day.totals.kcal) : 0;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Add meal" />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 18 }} showsVerticalScrollIndicator={false}>
          <View className="gap-1">
            <Text className="type-headline text-forest-ink">Which meal?</Text>
            <Text className="home__lead">Choose a slot so your daily totals stay organised.</Text>
          </View>

          <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
            {slots.map((s) => {
              const info = slotInfo[s];
              const selected = s === slot;
              return (
                <Pressable
                  key={s}
                  onPress={() => pickSlot(s)}
                  className="macro__slot"
                  style={selected ? { borderColor: colors.forest, borderWidth: 2 } : undefined}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${info.label}, ${info.window}${loggedSlots.has(s) ? ", logged today" : ""}`}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="macro__thumb" style={{ backgroundColor: `${info.tint}1F` }}>
                      <SymbolView name={info.icon} size={20} tintColor={info.tint} />
                    </View>
                    <View className="h-5 w-5 items-center justify-center rounded-pill" style={{ borderWidth: selected ? 0 : 1.5, borderColor: colors.sand, backgroundColor: selected ? colors.forest : "transparent" }}>
                      {selected && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.white} />}
                    </View>
                  </View>
                  <Text className="card__title mt-3">{info.label}</Text>
                  <Text className="post__time">{info.window}</Text>
                  {loggedSlots.has(s) && <Text className="macro__logged mt-1">Logged today</Text>}
                </Pressable>
              );
            })}
          </View>

          <View className="gap-2">
            <Text className="setup__section">Time</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Pressable onPress={() => setTime(null)} className={time === null ? "setup__chip setup__chip--selected flex-row gap-1.5" : "setup__chip flex-row gap-1.5"} accessibilityRole="button" accessibilityState={{ selected: time === null }}>
                <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" }} size={14} tintColor={time === null ? colors.white : colors.forestInk} />
                <Text className={time === null ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>Now</Text>
              </Pressable>
              {slotTimes(slot).map(([h, m]) => {
                const selected = time !== null && time[0] === h && time[1] === m;
                return (
                  <Pressable key={`${h}:${m}`} onPress={() => setTime([h, m])} className={selected ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="button" accessibilityState={{ selected }}>
                    <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{timeLabel(h, m)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View className="setup__note">
            <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={22} tintColor={colors.leaf} />
            <Text className="setup__note-text flex-1 self-center">You have {whole(remaining).toLocaleString("en-IN")} kcal left today.</Text>
          </View>
        </ScrollView>

        <View className="px-5 pb-3 pt-2">
          <Pressable onPress={continueToLog} className="btn-forest" accessibilityRole="button">
            <Text className="btn-forest__label">Continue</Text>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.white} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
