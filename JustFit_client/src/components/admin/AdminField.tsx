import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

import { useThemeColors } from "@/theme";

type AdminFieldProps = TextInputProps & {
  label: string;
  hint?: string;
};

// Labelled text input with an optional hint line
export function AdminField({ label, hint, multiline, ...inputProps }: AdminFieldProps) {
  const colors = useThemeColors();
  return (
    <View className="gap-1.5">
      <Text className="auth__label">{label}</Text>
      <TextInput
        className="admin__input"
        placeholderTextColor={colors.faint}
        multiline={multiline}
        style={multiline ? { minHeight: 72, textAlignVertical: "top" } : undefined}
        {...inputProps}
      />
      {hint && <Text className="admin__hint">{hint}</Text>}
    </View>
  );
}

type ChoiceChipsProps<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

// One-of picker drawn as chips (same look as the setup chips)
export function ChoiceChips<T extends string>({ label, options, value, onChange }: ChoiceChipsProps<T>) {
  return (
    <View className="gap-1.5">
      <Text className="auth__label">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              className={selected ? "setup__chip setup__chip--selected" : "setup__chip"}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
