import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { DIET_FILTERS, MEAL_SORTS, type Diet, type MealSort } from "@/lib/mealRules";

export type MealFilters = { diet: Diet | null; sort: MealSort };
export const NO_MEAL_FILTERS: MealFilters = { diet: null, sort: "recommended" };
export const hasMealFilters = (f: MealFilters) => f.diet !== NO_MEAL_FILTERS.diet || f.sort !== NO_MEAL_FILTERS.sort;

function Chip({ label, group, on, onPress }: { label: string; group: string; on: boolean; onPress: () => void }) {
  return (
    <PressableScale haptic="select" onPress={onPress} className={on ? "meal-chip meal-chip--on" : "meal-chip"} accessibilityRole="button" accessibilityLabel={`${group}: ${label}`} accessibilityState={{ selected: on }}>
      <Text className={on ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{label}</Text>
    </PressableScale>
  );
}

type MealFilterSheetProps = {
  value: MealFilters;
  onApply: (filters: MealFilters) => void;
  onClose: () => void;
  /** How many meals the filters would show, for the button ("Show 12 meals") */
  countFor: (filters: MealFilters) => number;
};

// The Meals tab's filter button: one diet and the order of the meals. Applied to the whole tab
// when Show meals is tapped; Clear filters goes back to every meal, recommended first, at once.
export function MealFilterSheet({ value, onApply, onClose, countFor }: MealFilterSheetProps) {
  const [draft, setDraft] = useState(value);
  const count = countFor(draft);
  const canClear = hasMealFilters(draft) || hasMealFilters(value);
  return (
    <BottomSheet onClose={onClose}>
      {(dismiss) => (
        <ScrollView contentContainerStyle={{ gap: 16 }} showsVerticalScrollIndicator={false}>
          <Text className="type-headline text-forest-ink">Filters</Text>
          <View className="gap-2">
            <Text className="type-subhead text-forest-ink">Diet</Text>
            <View className="flex-row flex-wrap gap-2">
              {DIET_FILTERS.map((d) => <Chip key={d.label} group="Diet" label={d.label} on={draft.diet === d.value} onPress={() => setDraft((f) => ({ ...f, diet: d.value }))} />)}
            </View>
          </View>
          <View className="gap-2">
            <Text className="type-subhead text-forest-ink">Sort by</Text>
            <View className="flex-row flex-wrap gap-2">
              {MEAL_SORTS.map((s) => <Chip key={s.value} group="Sort" label={s.label} on={draft.sort === s.value} onPress={() => setDraft((f) => ({ ...f, sort: s.value }))} />)}
            </View>
          </View>
          <PrimaryButton
            label={count === 0 ? "No meals match" : `Show ${count} ${count === 1 ? "meal" : "meals"}`}
            disabled={count === 0}
            onPress={() => { onApply(draft); dismiss(); }}
          />
          {canClear && (
            <Pressable onPress={() => { onApply(NO_MEAL_FILTERS); dismiss(); }} className="self-center" hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear filters and show every meal">
              <Text className="meal-link">Clear filters</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </BottomSheet>
  );
}
