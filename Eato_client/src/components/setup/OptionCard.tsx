import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import type { Icon } from "@/types/profile";
import { colors } from "@/theme";
import { fonts } from "@/constants/fonts";

type OptionCardProps = {
  label: string;
  description?: string;
  icon?: Icon;
  selected: boolean;
  onPress: () => void;
  // "row": icon, text, radio in a line. "tile": small stacked tile (diet, workout).
  // "grid": a tall tile for a 2 × 2 choice (fitness goal), icon in a circle above the label
  layout?: "row" | "tile" | "grid";
};

export function OptionCard({ label, description, icon, selected, onPress, layout = "row" }: OptionCardProps) {
  const cardClass = selected ? "setup__card setup__card--selected" : "setup__card";
  const tint = selected ? colors.forest : colors.inkSoft;
  const radio = (
    <View className={selected ? "setup__radio setup__radio--selected" : "setup__radio"}>
      {selected && <View className="setup__radio-dot" />}
    </View>
  );

  if (layout === "grid") {
    return (
      <Pressable
        onPress={onPress}
        className={`${cardClass} items-center justify-center gap-3`}
        style={{ width: "48.4%", minHeight: 152 }}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
      >
        {icon && (
          <View className={selected ? "setup__grid-icon setup__grid-icon--selected" : "setup__grid-icon"}>
            <SymbolView name={icon} size={26} tintColor={selected ? colors.leaf : colors.forestInk} />
          </View>
        )}
        <View className="items-center gap-0.5">
          <Text className="setup__card-title text-center">{label}</Text>
          {description && <Text className="setup__card-text text-center">{description}</Text>}
        </View>
      </Pressable>
    );
  }

  if (layout === "tile") {
    return (
      <Pressable onPress={onPress} className={`${cardClass} flex-1 items-center gap-2 py-3.5`}>
        {icon && <SymbolView name={icon} size={22} tintColor={tint} />}
        <Text className="setup__card-text text-center" style={{ color: tint, fontFamily: selected ? fonts.semibold : fonts.medium }}>
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
