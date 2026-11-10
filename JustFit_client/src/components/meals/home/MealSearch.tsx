import { Text, View } from "react-native";

import { FieldInput } from "@/components/FieldInput";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type MealSearchProps = {
  value: string;
  onChange: (value: string) => void;
  focused: boolean;
  onFocus: (focused: boolean) => void;
  hints: string[];
  filtered: boolean;
  onFilters: () => void;
};

// The search (meal, cuisine or ingredient) with its suggestions under it, and the filter button
// (a dot when a filter is on)
export function MealSearch({ value, onChange, focused, onFocus, hints, filtered, onFilters }: MealSearchProps) {
  const colors = useThemeColors();
  return (
    <View className="px-4" style={{ gap: 8 }}>
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <View className="shop-search" style={focused ? { borderWidth: 1, borderColor: colors.lineStrong } : undefined}>
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
          <FieldInput
            className="field-input flex-1"
            value={value}
            onChangeText={onChange}
            onFocus={() => onFocus(true)}
            onBlur={() => setTimeout(() => onFocus(false), 150)}
            placeholder="Search meals, cuisine or ingredients"
            placeholderTextColor={colors.faint}
            returnKeyType="search"
            autoCorrect={false}
            maxLength={40}
            accessibilityLabel="Search meals"
          />
          {value ? (
            <PressableScale onPress={() => onChange("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <SymbolView name={{ ios: "xmark.circle.fill", android: "cancel", web: "cancel" }} size={17} tintColor={colors.faint} />
            </PressableScale>
          ) : null}
        </View>
        <PressableScale onPress={onFilters} className="shop-filter" accessibilityRole="button" accessibilityLabel={filtered ? "Filters, some on" : "Filters"}>
          <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={20} tintColor={colors.ink} />
          {filtered && <View className="shop-filter__dot" />}
        </PressableScale>
      </View>
      {hints.length > 0 && (
        <View className="shop-suggest">
          {hints.map((h, i) => (
            <PressableScale key={h} onPress={() => { onChange(h); onFocus(false); }} className="flex-row items-center" style={{ gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderColor: colors.creamLine }} accessibilityRole="button">
              <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={13} tintColor={colors.faint} />
              <Text className="type-body text-forest-ink flex-1" numberOfLines={1}>{h}</Text>
            </PressableScale>
          ))}
        </View>
      )}
    </View>
  );
}
