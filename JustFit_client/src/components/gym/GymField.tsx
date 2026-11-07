import { Text, TextInput, View, type TextInputProps } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import type { GymIconName } from "@/constants/gymIcons";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// A labelled text box in the gym portal's look. With `icon`, the box is the outlined field of the
// Add Plan design (the icon inside, on the left) and the label is read only by screen readers.
export function GymField({ label, hint, style, icon, iconColor, ...inputProps }: TextInputProps & { label: string; hint?: string; icon?: GymIconName; iconColor?: string }) {
  const colors = useThemeColors();
  if (icon) {
    return (
      <View style={{ gap: 6 }}>
        <View className="gym-field--icon">
          {/* Once something is typed, the hint floats onto the border as the field's label */}
          {inputProps.value ? (
            <Text className="gym-field__float" numberOfLines={1} importantForAccessibility="no">{inputProps.placeholder}</Text>
          ) : null}
          <GymIcon name={icon} size={20} color={iconColor ?? colors.gymMuted} />
          <TextInput className="gym-field__icon-input" placeholderTextColor={colors.gymFaint} accessibilityLabel={label} style={style} {...inputProps} />
        </View>
        {hint ? <Text className="gym-tx__meta" style={{ paddingLeft: 4 }}>{hint}</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Text className="gym-field__label">{label}</Text>
      <TextInput className="gym-field__input" placeholderTextColor={colors.gymFaint} style={style} {...inputProps} />
      {hint ? <Text className="gym-tx__meta">{hint}</Text> : null}
    </View>
  );
}

// One-of picker as chips (plan length, online or cash, a filter)
// A chip with `disabled` can't be picked for now (faded, and told to the screen reader)
export function GymChips<T extends string | number>({ label, options, value, onChange }: { label?: string; options: { value: T; label: string; disabled?: boolean }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text className="gym-field__label">{label}</Text> : null}
      <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          const disabled = option.disabled === true && !selected;
          return (
            <PressableScale
              key={String(option.value)}
              onPress={() => {
                if (disabled) return;
                if (!selected) haptic.select();
                onChange(option.value);
              }}
              disabled={disabled}
              className={selected ? "gym-choice gym-choice--selected" : "gym-choice"}
              style={disabled ? { opacity: 0.4 } : undefined}
              accessibilityRole="radio"
              // A radio is read as checked or not (as the coach chips do; it reaches the web build too)
              aria-checked={selected}
              aria-disabled={disabled}
              accessibilityState={{ disabled }}
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
