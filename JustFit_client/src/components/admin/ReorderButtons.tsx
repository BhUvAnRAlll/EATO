import { Pressable, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type ReorderButtonsProps = {
  onUp: () => void;
  onDown: () => void;
  // The first item can't move up, the last can't move down
  first: boolean;
  last: boolean;
  disabled?: boolean;
  // Side by side (a row's controls line) or stacked (beside a card)
  direction?: "row" | "column";
  // Read out with the buttons ("Move Card 2 up")
  label?: string;
};

// Move up / Move down arrows for the admin's ordered lists. Each arrow has a full 44 pt touch
// area (a 36 pt circle and 4 pt of slop), so they are easy to hit on a small phone.
export function ReorderButtons({ onUp, onDown, first, last, disabled = false, direction = "row", label }: ReorderButtonsProps) {
  const colors = useThemeColors();
  const name = label ? `${label} ` : "";
  return (
    <View style={{ flexDirection: direction, gap: 4 }}>
      <Pressable
        onPress={onUp}
        disabled={disabled || first}
        hitSlop={4}
        className="h-9 w-9 items-center justify-center rounded-full bg-cream-deep"
        style={{ opacity: first ? 0.35 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={`Move ${name}up`}
        accessibilityState={{ disabled: disabled || first }}
      >
        <SymbolView name={{ ios: "chevron.up", android: "arrow_upward", web: "arrow_upward" }} size={16} tintColor={colors.forestInk} />
      </Pressable>
      <Pressable
        onPress={onDown}
        disabled={disabled || last}
        hitSlop={4}
        className="h-9 w-9 items-center justify-center rounded-full bg-cream-deep"
        style={{ opacity: last ? 0.35 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={`Move ${name}down`}
        accessibilityState={{ disabled: disabled || last }}
      >
        <SymbolView name={{ ios: "chevron.down", android: "arrow_downward", web: "arrow_downward" }} size={16} tintColor={colors.forestInk} />
      </Pressable>
    </View>
  );
}
