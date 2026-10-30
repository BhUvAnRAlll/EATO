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

// One white option card on the intake steps (soft shadow). Selected: a red outline on a pink
// wash and a red check, at the right of a row or as a badge in a tile's top-right corner.
// Icons are red in a soft pink circle in both states.
export function ChoiceCard({ label, note, icon, initials, selected, onPress, layout = "row", multi = false }: ChoiceCardProps) {
  const tile = layout === "tile";
  const leading = initials ? (
    <View className="coach__avatar">
      <Text className="coach__avatar-label">{initials}</Text>
    </View>
  ) : icon ? (
    <View className={tile ? "coach__option-icon" : "coach__option-icon h-11 w-11"}>
      <SymbolView name={icon} size={tile ? 26 : 22} tintColor={colors.primary} />
    </View>
  ) : null;
  const check = (
    <View className={tile ? "coach__check coach__check--badge" : "coach__check"}>
      <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={13} tintColor={colors.white} />
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      className={["coach__option", tile && "coach__option--tile basis-2/5 flex-1", selected && "coach__option--selected"].filter(Boolean).join(" ")}
      accessibilityRole={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      accessibilityLabel={note ? `${label}, ${note}` : label}
    >
      {leading}
      <View className={tile ? "items-center gap-1" : "min-w-0 flex-1 gap-0.5"}>
        <Text className={tile ? "coach__option-title coach__option-title--tile text-center" : "coach__option-title"}>{label}</Text>
        {note && <Text className={tile ? "coach__option-note text-center" : "coach__option-note"}>{note}</Text>}
      </View>
      {selected && check}
    </Pressable>
  );
}
