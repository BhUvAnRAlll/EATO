import { Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type OptionCardProps = {
  label: string;
  description?: string;
  icon?: Icon;
  selected: boolean;
  onPress: () => void;
  // "row": icon, text, radio in a line (goals). "tile": stacked, for grids (diet, workout).
  layout?: "row" | "tile";
};

export function OptionCard({ label, description, icon, selected, onPress, layout = "row" }: OptionCardProps) {
  const cardClass = selected ? "setup__card setup__card--selected" : "setup__card";
  const tint = selected ? colors.forest : colors.inkSoft;
  const radio = (
    <View className={selected ? "setup__radio setup__radio--selected" : "setup__radio"}>
      {selected && <View className="setup__radio-dot" />}
    </View>
  );

  if (layout === "tile") {
    return (
      <Pressable onPress={onPress} className={`${cardClass} flex-1 items-center gap-2 py-3.5`}>
        {icon && <SymbolView name={icon} size={22} tintColor={tint} />}
        <Text className="setup__card-text text-center" style={{ color: tint, fontWeight: selected ? "700" : "500" }}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} className={`${cardClass} flex-row items-center gap-3.5`}>
      {icon && (
        <View className="setup__card-icon">
          <SymbolView name={icon} size={20} tintColor={tint} />
        </View>
      )}
      <View className="flex-1">
        <Text className="setup__card-title">{label}</Text>
        {description && <Text className="setup__card-text mt-0.5">{description}</Text>}
      </View>
      {radio}
    </Pressable>
  );
}
