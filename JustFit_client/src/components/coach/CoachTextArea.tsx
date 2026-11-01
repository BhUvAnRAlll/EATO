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

// A multi-line text field on the coach screens: pink-tinted with a soft pink edge. TextInput
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
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.accentSoft,
        backgroundColor: colors.coachWash,
        color: colors.forestInk,
        fontFamily: fonts.regular,
        fontSize: 15,
        lineHeight: 22,
        textAlignVertical: "top",
      }}
    />
  );
}
