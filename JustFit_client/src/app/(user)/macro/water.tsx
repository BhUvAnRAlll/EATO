import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from "react-native";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { useFocusEffect } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { MacroHeader } from "@/components/macro/MacroHeader";
import { MonthCalendarSheet } from "@/components/macro/MonthCalendarSheet";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { clockTime, hourLabel, litres, longDate, macro, todayIso, type WaterDay, type WaterEntry } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { useThemeColors, useSwitchColors } from "@/theme";
import { track } from "@/lib/analytics";
import { haptic } from "@/lib/haptics";

const GLASS_ML = 250;
const GLASS = { width: 88, height: 152 };
const CHIPS = [150, 300, 750, 1000];

const entryTitle = (entry: WaterEntry) =>
  entry.label ?? (entry.source === "custom" ? "Custom amount" : entry.source === "workout" ? "Workout" : entry.amountMl >= 500 ? "Bottle" : "Glass");

// The day's water against an estimated target: log a glass, a bottle or any amount (today
// only), see and remove the day's entries, and turn hydration reminders on or off
export default function Water() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  // Under 375 pt the three quick tiles are narrow: a smaller amount keeps "+250 ml" on one line
  const compact = width < 375;
  const { selectedDate, jumpToDate } = useMacroStore();
  const today = todayIso();
  const isToday = selectedDate === today;
  const [day, setDay] = useState<WaterDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await macro.water(await getToken().catch(() => null), selectedDate);
    if (result.ok) setDay(result.data);
  }, [getToken, selectedDate]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A pull reads the day's water again
  const { refreshControl } = usePullToRefresh(load);

  const log = async (amountMl: number, source: "quick_add" | "custom", label?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await macro.logWater(await getToken().catch(() => null), { date: selectedDate, amountMl, source, label });
    setBusy(false);
    if (!result.ok) return setError(`Could not log water. ${result.status ? result.error : "Please check your connection and try again."}`);
    track("water_logged", { source });
    haptic.success();
    setSheetOpen(false);
    load();
  };

  const remove = async (entry: WaterEntry) => {
    setError(null);
    const result = await macro.removeWater(await getToken().catch(() => null), entry.id);
    if (!result.ok) return setError("Could not remove entry. Please try again.");
    load();
  };

  const toggleReminders = async (on: boolean) => {
    if (!day) return;
    setError(null);
    setDay({ ...day, preferences: { ...day.preferences, remindersEnabled: on } });
    const result = await macro.setReminders(await getToken().catch(() => null), { remindersEnabled: on });
    if (!result.ok) {
      setDay((current) => (current ? { ...current, preferences: { ...current.preferences, remindersEnabled: !on } } : current));
      setError("Could not save reminders. Please try again.");
    }
  };

  const switching = day !== null && day.date !== selectedDate;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader
          title="Water"
          subtitle={longDate(selectedDate)}
          right={
            <Pressable onPress={() => setCalendarOpen(true)} hitSlop={10} className="h-11 w-11 items-end justify-center" accessibilityRole="button" accessibilityLabel="Jump to a day">
              <SymbolView name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} size={20} tintColor={colors.forestInk} />
            </Pressable>
          }
        />

        {!day ? (
          <View className="px-4 pt-2">
            <ScreenSkeleton />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110, gap: 16, opacity: switching ? 0.55 : 1 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
            <ProgressCard day={day} isToday={isToday} />

            {isToday && (
              <View className="flex-row gap-2.5">
                <QuickTile title="+250 ml" subtitle="Glass" compact={compact} onPress={() => log(250, "quick_add", "Glass")} disabled={busy} />
                <QuickTile title="+500 ml" subtitle="Bottle" compact={compact} onPress={() => log(500, "quick_add", "Bottle")} disabled={busy} />
                <QuickTile title="Custom" subtitle="Pick amount" compact={compact} quiet onPress={() => setSheetOpen(true)} disabled={busy} />
              </View>
            )}

            {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}

            {isToday && (
              <View className="home__card flex-row items-center gap-3">
                <View className="macro__thumb" style={{ backgroundColor: colors.infoSoft }}>
                  <SymbolView name={{ ios: "bell.fill", android: "notifications", web: "notifications" }} size={20} tintColor={colors.fat} />
                </View>
                <View className="flex-1">
                  <Text className="card__title">Hydration reminders</Text>
                  <Text className="meta-text">
                    Every {day.preferences.intervalHours} hours · {hourLabel(day.preferences.startHour)} – {hourLabel(day.preferences.endHour)}
                  </Text>
                  <Text className="home__note mt-0.5">Saved now; reminders are sent once notifications arrive in a later update.</Text>
                </View>
                <Switch {...switchColors}
                  value={day.preferences.remindersEnabled}
                  onValueChange={toggleReminders}
                  accessibilityLabel="Hydration reminders"
                />
              </View>
            )}

            <View className="flex-row items-center justify-between">
              <Text className="setup__section">{isToday ? "Today's log" : "Log"}</Text>
              <Text className="meta-text">{day.entries.length} {day.entries.length === 1 ? "entry" : "entries"}</Text>
            </View>
            {day.entries.length === 0 ? (
              <DashedBlock
                icon={{ ios: "drop", android: "water_drop", web: "water_drop" }}
                title={isToday ? "Nothing logged yet" : "Nothing was logged"}
                text={isToday ? "Add your first glass to start the day." : "This day has no water logged. You can only log water on the day you drink it."}
              />
            ) : (
              <View className="gap-2">
                {day.entries.map((entry) => (
                  <View key={entry.id} className="list-card flex-row items-center gap-3" accessibilityLabel={`${entryTitle(entry)}, ${entry.amountMl} ml at ${clockTime(entry.loggedAt)}`}>
                    <View className="macro__thumb" style={{ backgroundColor: colors.infoSoft }}>
                      <SymbolView name={{ ios: "drop.fill", android: "water_drop", web: "water_drop" }} size={18} tintColor={colors.fat} />
                    </View>
                    <View className="flex-1">
                      <Text className="card__title">{entryTitle(entry)}</Text>
                      <Text className="meta-text">{clockTime(entry.loggedAt)}</Text>
                    </View>
                    <Text className="macro__kcal">{entry.amountMl} ml</Text>
                    {isToday && (
                      <Pressable onPress={() => remove(entry)} hitSlop={10} className="h-8 w-8 items-center justify-center" accessibilityRole="button" accessibilityLabel={`Remove ${entry.amountMl} ml`}>
                        <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={14} tintColor={colors.faint} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        )}

        {/* Floating action: hidden (not pressable) while the custom sheet is open */}
        {day && (
          <Pressable
            onPress={isToday ? () => log(GLASS_ML, "quick_add", "Glass") : () => jumpToDate(today)}
            disabled={sheetOpen || busy}
            className="macro__fab"
            style={{ opacity: sheetOpen ? 0 : 1, left: 20, justifyContent: "center" }}
            accessibilityRole="button"
            accessibilityLabel={isToday ? "Add a glass, 250 ml" : "Back to today"}
            accessibilityElementsHidden={sheetOpen}
          >
            <SymbolView name={isToday ? { ios: "plus", android: "add", web: "add" } : { ios: "arrow.uturn.backward", android: "undo", web: "undo" }} size={18} tintColor={colors.white} />
            <Text className="btn-forest__label">{isToday ? "Add a glass · 250 ml" : "Back to today"}</Text>
          </Pressable>
        )}
      </SafeAreaView>

      {sheetOpen && <CustomSheet busy={busy} onClose={() => setSheetOpen(false)} onAdd={(ml) => log(ml, "custom")} />}
      <MonthCalendarSheet visible={calendarOpen} selectedDate={selectedDate} today={today} onPick={jumpToDate} onClose={() => setCalendarOpen(false)} />
    </View>
  );
}

// The glass fills to the share of the target (over 450 ms when it changes), with marks at a
// quarter, half and three quarters. Hidden from screen readers: the numbers carry the meaning.
function Glass({ progress, targetMl }: { progress: number; targetMl: number }) {
  const colors = useThemeColors();
  const [fill] = useState(() => new Animated.Value(0));
  const first = useRef(true);
  useEffect(() => {
    const to = Math.min(1, Math.max(0, progress)) * GLASS.height;
    if (first.current) {
      fill.setValue(to);
      first.current = false;
    } else {
      Animated.timing(fill, { toValue: to, duration: 450, useNativeDriver: false }).start();
    }
  }, [progress, fill]);
  return (
    <View className="flex-row items-center gap-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="macro__glass" style={{ width: GLASS.width, height: GLASS.height }}>
        <Animated.View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: fill, backgroundColor: colors.fat, opacity: 0.85 }} />
      </View>
      <View style={{ height: GLASS.height }} className="justify-between py-1">
        {[0.75, 0.5, 0.25].map((share) => (
          <Text key={share} className="macro__weekday">{litres(targetMl * share)} L</Text>
        ))}
      </View>
    </View>
  );
}

function ProgressCard({ day, isToday }: { day: WaterDay; isToday: boolean }) {
  const colors = useThemeColors();
  const percent = Math.round(day.progress * 100);
  const done = day.consumedMl >= day.targetMl;
  const glasses = Math.ceil(day.remainingMl / GLASS_ML);
  return (
    <View className="home__card flex-row items-center gap-4">
      <Glass progress={day.progress} targetMl={day.targetMl} />
      <View className="flex-1 gap-1.5" accessibilityLabel={`${litres(day.consumedMl)} of ${litres(day.targetMl)} litres, ${percent}% of goal`}>
        <Text className="macro__overline">{isToday ? "Today" : "That day"}</Text>
        <Text>
          <Text className="macro__hero-number">{litres(day.consumedMl)}</Text>
          <Text className="macro__stat-label"> / {litres(day.targetMl)} L</Text>
        </Text>
        {day.medicalNote ? (
          <Text className="home__note" style={{ color: colors.muted }}>{day.medicalNote}</Text>
        ) : (
          <>
            <View className="self-start rounded-pill px-2.5 py-1" style={{ backgroundColor: colors.infoSoft }}>
              <Text className="macro__badge" style={{ color: colors.fat }}>{percent}% of goal</Text>
            </View>
            <Text className="meta-text">{done ? "Estimated target reached" : `${litres(day.remainingMl)} L to go · about ${glasses} ${glasses === 1 ? "glass" : "glasses"}`}</Text>
          </>
        )}
        {day.workoutMinutes ? <Text className="home__note">{day.workoutMinutes} min workout · +{day.workoutAdjustmentMl} ml</Text> : null}
        {day.usedFallbacks && <Text className="home__note">Add your weight in your profile for a closer estimate.</Text>}
      </View>
    </View>
  );
}

function QuickTile({ title, subtitle, quiet = false, compact, disabled, onPress }: { title: string; subtitle: string; quiet?: boolean; compact: boolean; disabled: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable onPress={onPress} disabled={disabled} className="macro__tile items-center" style={quiet ? { backgroundColor: colors.cream } : { opacity: disabled ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`${title}, ${subtitle}`}>
      <SymbolView name={quiet ? { ios: "slider.horizontal.3", android: "tune", web: "tune" } : { ios: "drop.fill", android: "water_drop", web: "water_drop" }} size={18} tintColor={colors.fat} />
      <Text className="card__title mt-1.5" style={compact ? { fontSize: 14, lineHeight: 18 } : undefined} numberOfLines={1}>{title}</Text>
      <Text className="meta-text text-center" style={compact ? { fontSize: 12, lineHeight: 16 } : undefined}>{subtitle}</Text>
    </Pressable>
  );
}

// Any amount from 10 ml to 3 L: a 50 ml stepper starting at 300 ml, and quick chips. Drawn in
// the screen's own tree, so it sits above the floating button.
function CustomSheet({ busy, onClose, onAdd }: { busy: boolean; onClose: () => void; onAdd: (ml: number) => void }) {
  const colors = useThemeColors();
  const [amount, setAmount] = useState(300);
  const step = (delta: number) => setAmount((current) => Math.min(3000, Math.max(10, current + delta)));
  return (
    <View className="confirm__backdrop" accessibilityViewIsModal>
      <Pressable style={{ flex: 1 }} onPress={busy ? undefined : onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View className="confirm__sheet gap-4">
        <Text className="setup__section text-center">Add water</Text>
        <View className="flex-row items-center justify-center gap-6">
          <Pressable onPress={() => step(-50)} className="home__icon-button" accessibilityRole="button" accessibilityLabel="50 ml less">
            <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={18} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="macro__hero-number" accessibilityLabel={`${amount} millilitres`}>{amount} ml</Text>
          <Pressable onPress={() => step(50)} className="home__icon-button" accessibilityRole="button" accessibilityLabel="50 ml more">
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={18} tintColor={colors.forestInk} />
          </Pressable>
        </View>
        <View className="flex-row flex-wrap justify-center gap-2">
          {CHIPS.map((ml) => (
            <Pressable key={ml} onPress={() => setAmount(ml)} className={amount === ml ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="button">
              <Text className={amount === ml ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => onAdd(amount)} disabled={busy} className="btn-forest" style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel={`Add ${amount} ml`}>
          {busy && <ActivityIndicator color={colors.white} />}
          <Text className="btn-forest__label">Add {amount} ml</Text>
        </Pressable>
        <Pressable onPress={onClose} disabled={busy} className="btn-outline" accessibilityRole="button">
          <Text className="btn-outline__label">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
