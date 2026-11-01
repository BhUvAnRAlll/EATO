import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

type SetupFieldProps = TextInputProps & {
  label: string;
  icon: Icon;
  // Text after the value, e.g. "cm" or "kg"
  unit?: string;
  // Text before the value, e.g. "+91"
  prefix?: string;
  // Turns the row into a picker: shows `value` and a chevron, calls onPress
  onPress?: () => void;
  // Icon shown instead of the chevron on a picker row (e.g. a calendar)
  trailingIcon?: Icon;
  // Shows `value` as plain text (no input, nothing to tap), with `trailingIcon` if given
  readOnly?: boolean;
  // Red outline: the value needs checking
  invalid?: boolean;
};

// Bordered row: icon, small label above the value, optional unit or chevron
export function SetupField({
  label,
  icon,
  unit,
  prefix,
  onPress,
  trailingIcon,
  readOnly = false,
  invalid = false,
  value,
  placeholder,
  ...inputProps
}: SetupFieldProps) {
  const colors = useThemeColors();
  const content = (
    <View className={invalid ? "setup__field setup__field--invalid" : "setup__field"}>
      <SymbolView name={icon} size={20} tintColor={colors.inkSoft} />
      <View className="flex-1">
        <Text className="setup__field-label">{label}</Text>
        {onPress || readOnly ? (
          <Text className={value ? "setup__field-input mt-0.5" : "setup__field-input setup__field-placeholder mt-0.5"}>
            {value || placeholder}
          </Text>
        ) : (
          <View className="mt-0.5 flex-row items-center gap-1.5">
            {prefix && <Text className="setup__field-input">{prefix}</Text>}
            <TextInput
              className="setup__field-input flex-1"
              placeholderTextColor={colors.faint}
              value={value}
              placeholder={placeholder}
              {...inputProps}
            />
          </View>
        )}
      </View>
      {unit && <Text className="setup__unit">{unit}</Text>}
      {onPress && (
        <SymbolView
          name={trailingIcon ?? { ios: "chevron.down", android: "expand_more", web: "expand_more" }}
          size={trailingIcon ? 20 : 16}
          tintColor={trailingIcon ? colors.inkSoft : colors.muted}
        />
      )}
      {!onPress && readOnly && trailingIcon && <SymbolView name={trailingIcon} size={16} tintColor={colors.muted} />}
    </View>
  );

  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{content}</Pressable> : content;
}
