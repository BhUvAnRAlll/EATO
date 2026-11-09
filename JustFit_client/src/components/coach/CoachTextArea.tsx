import { TextInput } from "react-native";

import { fonts } from "@/constants/fonts";
import { useThemeColors } from "@/theme";

type CoachTextAreaProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  minHeight?: number;
};

// A multi-line text field on the coach screens: a white field with a thin edge, so it reads as a
// field on the grey page. TextInput
// takes inline styles (see AGENTS.md); outline-none turns off the browser's focus ring on the web.
export function CoachTextArea({ value, onChangeText, placeholder, accessibilityLabel, minHeight = 120 }: CoachTextAreaProps) {
  const colors = useThemeColors();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.faint}
      multiline
      accessibilityLabel={accessibilityLabel}
      className="outline-none"
      style={{
        minHeight,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.creamLine,
        backgroundColor: colors.surface,
        color: colors.forestInk,
        fontFamily: fonts.regular,
        fontSize: 15,
        lineHeight: 22,
        textAlignVertical: "top",
      }}
    />
  );
}
