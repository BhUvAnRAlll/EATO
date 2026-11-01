import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { haptic } from "@/lib/haptics";
import { useAppearanceStore, type AppearanceMode } from "@/store/appearance";
import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

const OPTIONS: { value: AppearanceMode; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: { ios: "sun.max", android: "light_mode", web: "light_mode" } },
  { value: "dark", label: "Dark", icon: { ios: "moon", android: "dark_mode", web: "dark_mode" } },
  { value: "system", label: "System", icon: { ios: "iphone", android: "smartphone", web: "smartphone" } },
];

// Profile › Appearance: one quiet card, the iOS segmented look. A grey track holds three
// options; the chosen one sits on a white pill. Light is the default.
export function AppearanceCard() {
  const colors = useThemeColors();
  const mode = useAppearanceStore((state) => state.mode);
  const setMode = useAppearanceStore((state) => state.setMode);

  return (
    <View className="appearance">
      <Text className="appearance__title">Appearance</Text>
      <View className="appearance__track" accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {OPTIONS.map((option) => {
          const on = option.value === mode;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                if (on) return;
                haptic.select();
                setMode(option.value);
              }}
              className={on ? "appearance__option appearance__option--on" : "appearance__option"}
              accessibilityRole="radio"
              aria-checked={on}
              accessibilityLabel={option.label}
            >
              <SymbolView name={option.icon} size={15} tintColor={on ? colors.ink : colors.muted} />
              <Text className={on ? "appearance__label appearance__label--on" : "appearance__label"} numberOfLines={1}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
