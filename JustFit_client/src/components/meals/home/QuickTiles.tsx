import { View } from "react-native";

import { QuickTile } from "@/components/meals/home/ShopTiles";
import type { SymbolViewProps } from "@/components/SymbolView";
import type { QuickList } from "@/lib/mealRules";
import { useThemeColors, type Palette } from "@/theme";

type Tile = { list: QuickList; label: string; icon: SymbolViewProps["name"]; ground: keyof Palette; tint: keyof Palette };

// Five soft tints, one per tile, so the row reads as a set and none of it competes with Add
const TILES: Tile[] = [
  { list: "high_protein", label: "High Protein", icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }, ground: "tintPeach", tint: "iconPeach" },
  { list: "low_calorie", label: "Low Calorie", icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" }, ground: "tintBlue", tint: "iconBlue" },
  { list: "veg", label: "Veg", icon: { ios: "leaf.fill", android: "eco", web: "eco" }, ground: "tintGreen", tint: "iconGreen" },
  { list: "non_veg", label: "Non-Veg", icon: { ios: "fish.fill", android: "set_meal", web: "set_meal" }, ground: "tintRose", tint: "iconRose" },
  { list: "combos", label: "Combos", icon: { ios: "square.stack.3d.up.fill", android: "layers", web: "layers" }, ground: "tintLavender", tint: "iconLavender" },
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
