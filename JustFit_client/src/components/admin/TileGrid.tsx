import { Children, type ReactNode } from "react";
import { View } from "react-native";

// A wrapping row of admin tiles, `columns` to a row. The last row is filled with invisible tiles of
// the same class, so a lone tile never stretches across the screen.
export function TileGrid({ columns, tileClass, children }: { columns: number; tileClass: string; children: ReactNode }) {
  const count = Children.count(children);
  const ghosts = (columns - (count % columns)) % columns;
  return (
    <View className="flex-row flex-wrap" style={{ gap: 10 }}>
      {children}
      {Array.from({ length: ghosts }, (_, i) => (
        <View key={`ghost-${i}`} className={`${tileClass} admin-tile--ghost`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
      ))}
    </View>
  );
}
