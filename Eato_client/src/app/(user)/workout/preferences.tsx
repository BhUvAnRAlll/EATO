import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import {
  GOAL_LABEL,
  LEVEL_LABEL,
  SPLIT_LABEL,
  SPLIT_NOTE,
  WEEKDAYS_MONDAY_FIRST,
  formatWeekdays,
  shortDay,
  workoutApi,
  type Goal,
  type Level,
  type Plan,
  type Preferences,
} from "@/lib/workoutApi";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// Workout preferences: goal, level, training days and split. A full-screen modal, because
// changing the plan interrupts rather than drills down. Submitting builds a new plan from the
// four settings (the old one is kept with its history); a trainer's plan is read-only here.

type Values = Omit<Preferences, "editable">;
type Field = "goal" | "level" | "split";
type Option = { value: string; label: string; note?: string };

const MIN_DAYS = 3;
const GOALS: Goal[] = ["lose_weight", "build_muscle", "get_fitter", "stay_healthy"];
const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];
const SPLITS: Plan["split"][] = ["auto", "full_body", "upper_lower", "push_pull_legs"];

const OPTIONS: Record<Field, { title: string; options: Option[] }> = {
  goal: { title: "Fitness goal", options: GOALS.map((g) => ({ value: g, label: GOAL_LABEL[g] })) },
  level: { title: "Fitness level", options: LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] })) },
  split: { title: "Workout split", options: SPLITS.map((s) => ({ value: s, label: SPLIT_LABEL[s], note: SPLIT_NOTE[s] })) },
};

const ICONS: Record<Field | "weekdays", Icon> = {
  goal: { ios: "target", android: "flag", web: "flag" },
  level: { ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" },
  weekdays: { ios: "calendar", android: "calendar_month", web: "calendar_month" },
  split: { ios: "square.grid.2x2.fill", android: "grid_view", web: "grid_view" },
};

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

export default function WorkoutPreferences() {
  // Inside a full-screen modal the safe area may report no top inset, so it is applied by hand
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<{ state: "loading" } | { state: "failed"; error: string } | { state: "ready"; saved: Preferences }>({ state: "loading" });
  const [values, setValues] = useState<Values | null>(null);
  const [picking, setPicking] = useState<Field | null>(null);
  const [days, setDays] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await workoutApi.preferences(await getToken().catch(() => null));
      if (cancelled) return;
      if (!result.ok) return setLoad({ state: "failed", error: result.error });
      setLoad({ state: "ready", saved: result.data });
      const { editable: _editable, ...rest } = result.data;
      setValues(rest);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/workout"));
  const saved = load.state === "ready" ? load.saved : null;
  const editable = saved?.editable ?? false;
  const dirty =
    saved !== null && values !== null &&
    (values.goal !== saved.goal || values.level !== saved.level || values.split !== saved.split || !sameDays(values.weekdays, saved.weekdays));

  const choose = (field: Field, value: string) => {
    Haptics.selectionAsync().catch(() => {});
    setValues((v) => (v ? { ...v, [field]: value } : v));
    setPicking(null);
    setError(null);
  };

  const submit = async () => {
    if (!values || !dirty || saving) return;
    setSaving(true);
    setError(null);
    const result = await workoutApi.updatePreferences(await getToken().catch(() => null), todayIso(), values);
    setSaving(false);
    if (!result.ok) return setError(result.error || "Could not save your preferences");
    // No toast: the hub behind the modal already shows the new plan when it comes back into view
    close();
  };

  const rows: { field: Field | "weekdays"; label: string; value: string }[] = values
    ? [
        { field: "goal", label: "Fitness goal", value: GOAL_LABEL[values.goal] },
        { field: "level", label: "Fitness level", value: LEVEL_LABEL[values.level] },
        { field: "weekdays", label: "Workout days", value: formatWeekdays(values.weekdays) },
        { field: "split", label: "Workout split", value: SPLIT_LABEL[values.split] },
      ]
    : [];

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top + 8 }}>
      <StatusBar style="dark" />
      <View className="flex-row justify-end px-5">
        <Pressable onPress={close} hitSlop={8} className="h-11 w-11 items-center justify-center rounded-full bg-surface" accessibilityRole="button" accessibilityLabel="Close">
          <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={16} tintColor={colors.forestInk} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
        <View className="gap-1">
          <Text className="type-title text-forest-ink">Workout preferences</Text>
          <Text className="home__note">Review your workout preferences. You can edit anytime before submitting.</Text>
        </View>

        {load.state === "loading" ? (
          <View className="items-center py-16">
            <ActivityIndicator color={colors.forest} />
          </View>
        ) : load.state === "failed" ? (
          <DashedBlock
            icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
            title="Could not load your preferences"
            text={`${load.error.replace(/\.$/, "")}. Tap to try again.`}
            onPress={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <>
            {!editable && (
              <View className="info-banner">
                <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.inkSoft} />
                <Text className="info-banner__text">Your trainer manages this plan, so these settings are read-only.</Text>
              </View>
            )}
            <View className="gap-2.5">
              {rows.map((row) => (
                <Pressable
                  key={row.field}
                  onPress={editable ? () => (row.field === "weekdays" ? setDays(values?.weekdays ?? []) : setPicking(row.field)) : undefined}
                  disabled={!editable}
                  className="home__card flex-row items-center gap-3"
                  accessibilityRole={editable ? "button" : undefined}
                  accessibilityLabel={`${row.label}: ${row.value}`}
                >
                  <View className="workout-pref__icon">
                    <SymbolView name={ICONS[row.field]} size={20} tintColor={colors.forest} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="type-overline text-muted">{row.label}</Text>
                    <Text className="card__title" numberOfLines={1}>{row.value}</Text>
                  </View>
                  {editable && (
                    <View className="workout-pref__edit">
                      <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={14} tintColor={colors.forestInk} />
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Footer: never over data that hasn't arrived */}
      {load.state === "ready" && editable && (
        <View className="gap-2 border-t border-cream-line px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
          {error ? (
            <FormAlert message={error} />
          ) : (
            <Text className="home__note text-center">Submitting builds a new plan. Your workout history stays.</Text>
          )}
          <Pressable onPress={submit} disabled={!dirty || saving} className="btn-forest" style={{ opacity: !dirty || saving ? 0.45 : 1 }} accessibilityRole="button" accessibilityState={{ disabled: !dirty || saving }} accessibilityLabel="Submit">
            {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Submit</Text>}
          </Pressable>
          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-cream-line" />
            <Text className="type-caption text-muted">OR</Text>
            <View className="h-px flex-1 bg-cream-line" />
          </View>
          <Pressable onPress={() => router.push("/workout/recreate")} disabled={saving} className="btn-outline" accessibilityRole="button" accessibilityLabel="Re-create plan">
            <Text className="btn-outline__label">Re-create plan</Text>
          </Pressable>
        </View>
      )}

      <OptionSheet field={picking} selected={picking && values ? values[picking] : null} onChoose={choose} onClose={() => setPicking(null)} />
      <WeekdaySheet
        days={days}
        onToggle={(d) => {
          Haptics.selectionAsync().catch(() => {});
          setDays((list) => (list ? (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]) : list));
        }}
        onDone={() => {
          if (!days || days.length < MIN_DAYS) return;
          setValues((v) => (v ? { ...v, weekdays: WEEKDAYS_MONDAY_FIRST.filter((d) => days.includes(d)) } : v));
          setDays(null);
          setError(null);
        }}
        onClose={() => setDays(null)}
      />
    </View>
  );
}

function OptionSheet({ field, selected, onChoose, onClose }: { field: Field | null; selected: string | null; onChoose: (field: Field, value: string) => void; onClose: () => void }) {
  const sheet = field ? OPTIONS[field] : null;
  return (
    <Modal visible={field !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="verify__backdrop" onPress={onClose} accessibilityLabel="Close">
        <Pressable className="verify__sheet gap-2" onPress={() => {}} accessibilityViewIsModal>
          <Text className="setup__section text-center">{sheet?.title ?? ""}</Text>
          <View accessibilityRole="radiogroup">
            {field &&
              sheet?.options.map((option) => {
                const isSelected = option.value === selected;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => onChoose(field, option.value)}
                    className="flex-row items-center gap-3 py-3"
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={option.note ? `${option.label}: ${option.note}` : option.label}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="card__title">{option.label}</Text>
                      {option.note && <Text className="post__time">{option.note}</Text>}
                    </View>
                    <View className={isSelected ? "radio radio--selected" : "radio"}>{isSelected && <View className="radio__dot" />}</View>
                  </Pressable>
                );
              })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Reopening starts from the saved choice, so an abandoned edit never leaks into the form
function WeekdaySheet({ days, onToggle, onDone, onClose }: { days: number[] | null; onToggle: (d: number) => void; onDone: () => void; onClose: () => void }) {
  const n = days?.length ?? 0;
  const enough = n >= MIN_DAYS;
  return (
    <Modal visible={days !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="verify__backdrop" onPress={onClose} accessibilityLabel="Close">
        <Pressable className="verify__sheet gap-3" onPress={() => {}} accessibilityViewIsModal>
          <View className="items-center gap-1">
            <Text className="setup__section">Workout days</Text>
            <Text className="home__note">{enough ? `${n} days a week` : `Pick at least ${MIN_DAYS} days (${n} chosen).`}</Text>
          </View>
          <View className="flex-row gap-1.5">
            {WEEKDAYS_MONDAY_FIRST.map((d) => {
              const on = days?.includes(d) ?? false;
              return (
                <Pressable
                  key={d}
                  onPress={() => onToggle(d)}
                  className={on ? "workout-pref__day workout-pref__day--on" : "workout-pref__day"}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={shortDay(d)}
                >
                  <Text className="type-caption" style={{ color: on ? colors.white : colors.forestInk, fontWeight: "700" }}>{shortDay(d).slice(0, 2)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={onDone} disabled={!enough} className="btn-forest" style={{ opacity: enough ? 1 : 0.45 }} accessibilityRole="button" accessibilityState={{ disabled: !enough }} accessibilityLabel="Done">
            <Text className="btn-forest__label">Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
