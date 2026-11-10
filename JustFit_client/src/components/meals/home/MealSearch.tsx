import { useEffect, useState } from "react";
import { Keyboard, Text, View } from "react-native";

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
  /** Dishes the placeholder cycles through: Search “smoothie”, Search “paneer bowl”…, also offered as Popular searches */
  examples: string[];
  /** Searches made this session, newest first, shown when the box is tapped while empty */
  recent: string[];
  /** A search chosen from a list or submitted from the keyboard (it becomes a recent search) */
  onPick: (query: string) => void;
  onForget: (query: string) => void;
  onClearRecent: () => void;
};

const EXAMPLE_EVERY_MS = 2500;

// The search (meal, cuisine or ingredient) with the filter button (a dot when a filter is on). Tapped
// while empty it lists recent and popular searches; while typing, the names that match
export function MealSearch({ value, onChange, focused, onFocus, hints, filtered, onFilters, examples, recent, onPick, onForget, onClearRecent }: MealSearchProps) {
  const colors = useThemeColors();
  // The placeholder moves to the next example every few seconds, only while it is showing
  const [shown, setShown] = useState(0);
  const cycling = !focused && !value && examples.length > 1;
  useEffect(() => {
    if (!cycling) return;
    const timer = setInterval(() => setShown((i) => i + 1), EXAMPLE_EVERY_MS);
    return () => clearInterval(timer);
  }, [cycling]);
  const example = examples.length > 0 ? examples[shown % examples.length] : null;
  const pick = (query: string) => {
    onPick(query);
    onFocus(false);
    Keyboard.dismiss();
  };
  const popular = examples.slice(0, 6);
  const showStart = focused && !value.trim() && (recent.length > 0 || popular.length > 0);
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
            placeholder={example ? `Search “${example}”` : "Search meals, cuisine or ingredients"}
            placeholderTextColor={colors.faint}
            returnKeyType="search"
            onSubmitEditing={() => value.trim() && pick(value)}
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
            <PressableScale key={h} onPress={() => pick(h)} className="flex-row items-center" style={{ gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderColor: colors.creamLine }} accessibilityRole="button">
              <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={13} tintColor={colors.faint} />
              <Text className="type-body text-forest-ink flex-1" numberOfLines={1}>{h}</Text>
            </PressableScale>
          ))}
        </View>
      )}
      {showStart && (
        <View className="shop-suggest" style={{ paddingVertical: 6 }}>
          {recent.length > 0 && (
            <>
              <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 }}>
                <Text className="shop-suggest__title">Recent searches</Text>
                <PressableScale onPress={onClearRecent} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear recent searches">
                  <Text className="shop-suggest__clear">Clear all</Text>
                </PressableScale>
              </View>
              {recent.map((r) => (
                <View key={r} className="flex-row items-center" style={{ paddingLeft: 14, paddingRight: 6 }}>
                  <PressableScale onPress={() => pick(r)} className="flex-row items-center flex-1" style={{ gap: 10, paddingVertical: 10 }} accessibilityRole="button" accessibilityLabel={`Search ${r}`}>
                    <SymbolView name={{ ios: "clock.arrow.circlepath", android: "history", web: "history" }} size={15} tintColor={colors.faint} />
                    <Text className="type-body text-forest-ink flex-1" numberOfLines={1}>{r}</Text>
                  </PressableScale>
                  <PressableScale onPress={() => onForget(r)} hitSlop={6} style={{ padding: 8 }} accessibilityRole="button" accessibilityLabel={`Remove ${r} from recent searches`}>
                    <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={13} tintColor={colors.faint} />
                  </PressableScale>
                </View>
              ))}
            </>
          )}
          {popular.length > 0 && (
            <View style={{ paddingHorizontal: 14, paddingTop: recent.length ? 10 : 8, paddingBottom: 10, gap: 8, borderTopWidth: recent.length ? 1 : 0, borderColor: colors.creamLine }}>
              <Text className="shop-suggest__title">Popular searches</Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {popular.map((p) => (
                  <PressableScale key={p} onPress={() => pick(p)} className="shop-suggest__chip" haptic="select" accessibilityRole="button" accessibilityLabel={`Search ${p}`}>
                    <SymbolView name={{ ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" }} size={12} tintColor={colors.muted} />
                    <Text className="shop-suggest__chip-text" numberOfLines={1}>{p}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
