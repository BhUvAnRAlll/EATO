import { Pressable, Text } from "react-native";

type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  // Stretch to share a row equally (segmented choices)
  grow?: boolean;
};

// Pill choice; filled forest green when selected
export function Chip({ label, selected, onPress, grow = false }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      className={`${selected ? "setup__chip setup__chip--selected" : "setup__chip"}${grow ? " flex-1" : ""}`}
    >
      <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{label}</Text>
    </Pressable>
  );
}
