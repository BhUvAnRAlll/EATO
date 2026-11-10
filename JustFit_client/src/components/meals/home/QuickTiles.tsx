import { View } from "react-native";

import { QuickTile } from "@/components/meals/home/ShopTiles";
import type { SymbolViewProps } from "@/components/SymbolView";
import type { QuickList } from "@/lib/mealRules";
import { useThemeColors, type Palette } from "@/theme";

type Tile = { list: QuickList; label: string; icon: SymbolViewProps["name"]; ground: keyof Palette; tint: keyof Palette };

// Five soft tints, one per tile, so the row reads as a set and none of it competes with Add
const TILES: Tile[] = [
  { list: "high_protein", label: "High Protein", icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }, ground: "tintPeach", tint: "iconPeach" },
  { list: "low_calorie", label: "Low Calorie", icon: { ios: "scalemass.fill", android: "monitor_weight", web: "monitor_weight" }, ground: "tintBlue", tint: "iconBlue" },
  { list: "veg", label: "Veg", icon: { ios: "carrot.fill", android: "nutrition", web: "nutrition" }, ground: "tintGreen", tint: "iconGreen" },
  { list: "non_veg", label: "Non-Veg", icon: { ios: "fish.fill", android: "set_meal", web: "set_meal" }, ground: "tintRose", tint: "iconRose" },
  { list: "combos", label: "Combos", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, ground: "tintLavender", tint: "iconLavender" },
];

export function QuickTiles({ width, onPick }: { width: number; onPick: (list: QuickList) => void }) {
  const colors = useThemeColors();
  const tileWidth = Math.floor((Math.min(width, 760) - 32) / TILES.length);
  return (
    <View className="flex-row px-4">
      {TILES.map((t) => <QuickTile key={t.list} label={t.label} icon={t.icon} ground={colors[t.ground]} tint={colors[t.tint]} width={tileWidth} onPress={() => onPick(t.list)} />)}
    </View>
  );
}
