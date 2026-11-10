import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { FieldInput } from "@/components/FieldInput";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { DietMark } from "@/components/meals/DietMark";
import type { PickerMeal } from "@/lib/dietPlanApi";
import { macroLine, rupees, searchMeals } from "@/lib/mealRules";
import { useThemeColors } from "@/theme";

type DietMealPickerProps = {
  menu: PickerMeal[];
  // Already picked for this meal (not offered again)
  picked: string[];
  // The client's planned meal, to sort the closest first
  kcal: number | null;
  onPick: (mealId: string) => void;
  onClose: () => void;
};

// The trainer's "Recommend a justFit meal": the menu with a search, closest to the planned kcal
// first. A meal that breaks the client's diet or names an allergy (only known when they share) is
// greyed out with the reason; a dislike is marked. The server checks the same again on save.
export function DietMealPicker({ menu, picked, kcal, onPick, onClose }: DietMealPickerProps) {
  const colors = useThemeColors();
  const [search, setSearch] = useState("");
  const list = useMemo(() => {
    const open = menu.filter((m) => !picked.includes(m.id));
    const found = search.trim() ? searchMeals(open, [], search) : open;
    if (!kcal || search.trim()) return found;
    return [...found].sort((a, b) => Number(a.problem !== null) - Number(b.problem !== null) || Math.abs(a.calories - kcal) - Math.abs(b.calories - kcal));
  }, [menu, picked, search, kcal]);

  return (
    <BottomSheet onClose={onClose}>
      {(dismiss) => (
        <View style={{ gap: 12, maxHeight: 560 }}>
          <Text className="type-headline text-forest-ink">Recommend a justFit meal</Text>
          <View className="shop-search">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={16} tintColor={colors.muted} />
            <FieldInput className="field-input flex-1" value={search} onChangeText={setSearch} placeholder="Search the menu" placeholderTextColor={colors.faint} autoCorrect={false} maxLength={40} accessibilityLabel="Search the menu" />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {list.length === 0 && <Text className="meta-text">No meals match.</Text>}
            {list.map((m) => (
              <PressableScale
                key={m.id}
                haptic="select"
                disabled={m.problem !== null}
                onPress={() => { onPick(m.id); dismiss(); }}
                className="list-row"
                style={{ opacity: m.problem ? 0.5 : 1 }}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}, ${m.calories} kcal${m.problem ? `, can't pick: ${m.problem}` : ""}`}
                accessibilityState={{ disabled: m.problem !== null }}
              >
                <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <DietMark diet={m.diet} />
                    <Text className="list-row__label flex-1" numberOfLines={1}>{m.name}</Text>
                    <Text className="meta-text">{rupees(m.price)}</Text>
                  </View>
                  <Text className="meta-text" numberOfLines={1}>{macroLine(m)}</Text>
                  {m.problem ? <Text className="home__note" style={{ color: colors.danger }}>{m.problem}</Text> : null}
                  {m.warning ? <Text className="home__note" style={{ color: colors.warning }}>{m.warning}</Text> : null}
                </View>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      )}
    </BottomSheet>
  );
}
