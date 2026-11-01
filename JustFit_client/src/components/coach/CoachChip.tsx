import { Text } from "react-native";

import { PressableScale } from "@/components/PressableScale";

type CoachChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  // Two to a row, stretched (segmented choices); otherwise sized by the label
  grow?: boolean;
  // Checkbox lists (more than one can be picked) read differently to a screen reader
  multi?: boolean;
};

// A small choice pill on the coach screens: white with a soft shadow, a red outline on a pink
// wash when picked (like the option cards)
export function CoachChip({ label, selected, onPress, grow = false, multi = false }: CoachChipProps) {
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.95}
      haptic="select"
      className={["coach__chip", !grow && "coach__chip--wrap", grow && "basis-2/5 flex-1", selected && "coach__chip--selected"].filter(Boolean).join(" ")}
      accessibilityRole={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      accessibilityLabel={label}
    >
      <Text numberOfLines={1} className={selected ? "coach__chip-label coach__chip-label--selected" : "coach__chip-label"}>{label}</Text>
    </PressableScale>
  );
}
