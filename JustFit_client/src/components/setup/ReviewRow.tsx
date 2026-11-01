import { Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

type ReviewRowProps = {
  label: string;
  icon: Icon;
  // Icon colour and the soft tile behind it
  tint: string;
  background: string;
  value: string;
  placeholder?: string;
  // Shown after the value box, e.g. "kg"
  unit?: string;
  // Editable number: typed text comes back here
  onChangeText?: (text: string) => void;
  // Picker row: shows the value and a chevron, calls onPress
  onPress?: () => void;
  // Red outline: the value needs checking
  invalid?: boolean;
};

// One value from the report: tinted icon, label, and the value box with its unit.
// Without onChangeText or onPress the value is shown read-only (e.g. a computed BMI).
export function ReviewRow({ label, icon, tint, background, value, placeholder = "—", unit, onChangeText, onPress, invalid = false }: ReviewRowProps) {
  const colors = useThemeColors();
  const control = (
    <View className="review__control">
      <View className={onChangeText ? "review__value" : "review__value review__value--auto"}>
        {onChangeText ? (
          <TextInput
            className="review__input"
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.faint}
            keyboardType="decimal-pad"
            accessibilityLabel={label}
          />
        ) : (
          <Text className={value ? "review__input" : "review__input review__input--empty"} numberOfLines={1}>
            {value || placeholder}
          </Text>
        )}
      </View>
      {unit && <Text className="review__unit">{unit}</Text>}
      {onPress && (
        <View className="pr-2">
          <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={16} tintColor={colors.muted} />
        </View>
      )}
    </View>
  );

  return (
    <View className={invalid ? "review__row review__row--invalid" : "review__row"}>
      <View className="review__icon" style={{ backgroundColor: background }}>
        <SymbolView name={icon} size={20} tintColor={tint} />
      </View>
      <Text className="review__label" numberOfLines={3}>
        {label}
      </Text>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value || placeholder}`}>
          {control}
        </Pressable>
      ) : (
        control
      )}
    </View>
  );
}
