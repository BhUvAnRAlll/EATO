import { Text, TextInput, View, type TextInputProps } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// A labelled text box in the gym portal's look
export function GymField({ label, hint, style, ...inputProps }: TextInputProps & { label: string; hint?: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: 6 }}>
      <Text className="gym-field__label">{label}</Text>
      <TextInput className="gym-field__input" placeholderTextColor={colors.gymFaint} style={style} {...inputProps} />
      {hint ? <Text className="gym-tx__meta">{hint}</Text> : null}
    </View>
  );
}

// One-of picker as chips (plan length, online or cash, a filter)
export function GymChips<T extends string | number>({ label, options, value, onChange }: { label?: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text className="gym-field__label">{label}</Text> : null}
      <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <PressableScale
              key={String(option.value)}
              onPress={() => {
                if (!selected) haptic.select();
                onChange(option.value);
              }}
              className={selected ? "gym-choice gym-choice--selected" : "gym-choice"}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
            >
              <Text className={selected ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{option.label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

// Whole rupees from what was typed ("4,500" → 4500); NaN when empty
export const rupeesFromText = (text: string) => (text.trim() === "" ? Number.NaN : Number.parseInt(text.replace(/[^0-9]/g, ""), 10));
// Keeps only digits as someone types an amount
export const amountInput = (text: string) => text.replace(/[^0-9]/g, "").slice(0, 7);
