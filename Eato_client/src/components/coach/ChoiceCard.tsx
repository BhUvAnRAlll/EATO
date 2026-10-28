import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type ChoiceCardProps = {
  label: string;
  note?: string;
  icon?: Icon;
  // Initials in a lavender circle instead of an icon (the coaches)
  initials?: string;
  selected: boolean;
  onPress: () => void;
  // "row": full width with the check on the right; "tile": half width, centred
  layout?: "row" | "tile";
  // Checkbox lists (more than one can be picked) read differently to a screen reader
  multi?: boolean;
};

// One white option card on the intake steps. Selected: a black outline, a black icon circle
// and a black check.
export function ChoiceCard({ label, note, icon, initials, selected, onPress, layout = "row", multi = false }: ChoiceCardProps) {
  const leading = initials ? (
    <View className="coach__avatar">
      <Text className="coach__avatar-label">{initials}</Text>
    </View>
  ) : icon ? (
    <View className={selected ? "coach__option-icon coach__option-icon--selected" : "coach__option-icon"}>
      <SymbolView name={icon} size={20} tintColor={selected ? colors.white : colors.forestInk} />
    </View>
  ) : null;

  return (
    <Pressable
      onPress={onPress}
      className={`${selected ? "coach__option coach__option--selected" : "coach__option"}${layout === "tile" ? " basis-2/5 flex-1 flex-col justify-center" : ""}`}
      accessibilityRole={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      accessibilityLabel={note ? `${label}, ${note}` : label}
    >
      {leading}
      <View className={layout === "tile" ? "items-center" : "min-w-0 flex-1"}>
        <Text className={layout === "tile" ? "card__title text-center" : "card__title"}>{label}</Text>
        {note && <Text className={layout === "tile" ? "post__time text-center" : "post__time"}>{note}</Text>}
      </View>
      {layout === "row" && selected && (
        <View className="coach__check">
          <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.white} />
        </View>
      )}
    </Pressable>
  );
}
