import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

type SegmentedProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string; // for screen readers
};

// A row of equal segments with one selected (units, slots, periods)
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  return (
    <View className="macro__segmented" accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale haptic="select"
            key={option.value}
            onPress={() => onChange(option.value)}
            className={selected ? "macro__segment macro__segment--selected" : "macro__segment"}
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityLabel={option.label}
          >
            <Text className={selected ? "macro__segment-label macro__segment-label--selected" : "macro__segment-label"} numberOfLines={1}>
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
