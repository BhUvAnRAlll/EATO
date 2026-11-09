import { Text, TextInput, View, type TextInputProps } from "react-native";

import { GymIcon } from "@/components/gym/GymIcon";
import type { GymIconName } from "@/constants/gymIcons";
import { haptic } from "@/lib/haptics";
import { ChoiceChip } from "@/components/gym/GymChip";
import { useThemeColors } from "@/theme";

// A labelled text box in the gym portal's look: the outlined field of the Add Member and Add Plan
// designs, with its icon inside on the left. The label sits on the border once something is
// typed (the placeholder names the field until then); `pinLabel` keeps it there from the start,
// for a field whose placeholder is only an example ("For example: Tumkur"). Every gym field is
// this one box (2026-11-08): the grey filled box is gone.
export function GymField({ label, hint, style, icon, iconColor, pinLabel = false, ...inputProps }: TextInputProps & { label: string; hint?: string; icon?: GymIconName; iconColor?: string; pinLabel?: boolean }) {
  const colors = useThemeColors();
  const showLabel = pinLabel || !icon || Boolean(inputProps.value);
  return (
    <View style={{ gap: 6 }}>
      <View className="gym-field--icon">
        {showLabel ? (
          <Text className="gym-field__float" numberOfLines={1} importantForAccessibility="no">{label}</Text>
        ) : null}
        {icon ? <GymIcon name={icon} size={20} color={iconColor ?? colors.gymMuted} /> : null}
        <TextInput className="gym-field__icon-input" placeholderTextColor={colors.gymFaint} accessibilityLabel={label} style={style} {...inputProps} />
      </View>
      {hint ? <Text className="gym-tx__meta" style={{ paddingLeft: 4 }}>{hint}</Text> : null}
    </View>
  );
}

// One-of picker as chips (plan length, online or cash, a filter)
// A chip with `disabled` can't be picked for now (faded, and told to the screen reader).
// `segmented`: the chips share one row in equal widths (a short set, like Today / 7 days / 30 days).
export function GymChips<T extends string | number>({ label, options, value, onChange, segmented = false }: { label?: string; options: { value: T; label: string; disabled?: boolean }[]; value: T; onChange: (value: T) => void; segmented?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text className="gym-field__label" style={{ fontSize: 14 }}>{label}</Text> : null}
      <View className={segmented ? "flex-row" : "flex-row flex-wrap"} style={{ gap: 8 }} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          const disabled = option.disabled === true && !selected;
          return (
            <ChoiceChip
              key={String(option.value)}
              onPress={() => {
                if (disabled) return;
                if (!selected) haptic.select();
                onChange(option.value);
              }}
              disabled={disabled}
              selected={selected}
              label={option.label}
              style={{ ...(disabled ? { opacity: 0.4 } : {}), ...(segmented ? { flex: 1 } : {}) }}
              accessibilityRole="radio"
              // A radio is read as checked or not (as the coach chips do; it reaches the web build too)
              aria-checked={selected}
              aria-disabled={disabled}
              accessibilityState={{ disabled }}
            />
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
