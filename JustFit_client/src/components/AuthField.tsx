import { useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { SymbolView, type SymbolViewProps } from "@/components/SymbolView";

import { colors } from "@/theme";

type AuthFieldProps = TextInputProps & {
  // Optional label above the box (the log in card has none)
  label?: string;
  icon: SymbolViewProps["name"];
  // Hides the text and shows an eye button to reveal it
  isPassword?: boolean;
  // Shown before the typed text and not part of it (the +91 of a mobile number)
  prefix?: string;
};

export function AuthField({ label, icon, isPassword = false, prefix, ...inputProps }: AuthFieldProps) {
  const [isHidden, setIsHidden] = useState(isPassword);

  return (
    <View className="gap-2">
      {label && <Text className="auth__label">{label}</Text>}
      <View className="auth__field">
        <SymbolView name={icon} size={18} tintColor={colors.inkSoft} />
        {prefix && <Text className="auth__prefix">{prefix}</Text>}
        <TextInput
          className="auth__input"
          placeholderTextColor={colors.faint}
          secureTextEntry={isHidden}
          {...inputProps}
        />
        {isPassword && (
          <Pressable onPress={() => setIsHidden(!isHidden)} hitSlop={12}>
            <SymbolView
              name={
                isHidden
                  ? { ios: "eye.slash", android: "visibility_off", web: "visibility_off" }
                  : { ios: "eye", android: "visibility", web: "visibility" }
              }
              size={20}
              tintColor={colors.inkSoft}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}
