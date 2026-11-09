import { TextInput, type TextInputProps } from "react-native";

import { useThemeColors } from "@/theme";

type FieldInputProps = TextInputProps & { className?: string };

// The text box inside a field row (`setup__field`, a macro box). It has no fixed line height, so a
// number grows with the phone's text size instead of being clipped, a little padding above and
// below, and on Android the font's extra top padding is off, so the value sits centred beside its
// icon and unit. TextInput-only props go inline (see AGENTS.md).
export function FieldInput({ className, style, ...props }: FieldInputProps) {
  const colors = useThemeColors();
  return (
    <TextInput
      className={className ? `field-input ${className}` : "field-input"}
      placeholderTextColor={colors.faint}
      style={[{ textAlignVertical: "center", includeFontPadding: false }, style]}
      {...props}
    />
  );
}
