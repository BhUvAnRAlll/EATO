import { Text, View } from "react-native";
import { router } from "expo-router";

import { TileGrid } from "@/components/admin/TileGrid";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { adminSections } from "@/data/admin";
import { useResponsive } from "@/lib/responsive";
import { useThemeColors } from "@/theme";

// Super Admin › More: every area of the portal as a tile, in groups (meals and kitchens, the Meals
// tab, gyms, fitness content, platform), one tap from the tab bar
export default function AdminMoreTab() {
  const colors = useThemeColors();
  const { compact } = useResponsive();
  const tile = compact ? "admin-tile admin-tile--half" : "admin-tile";
  return (
    <AdminScreen title="More" hideBack>
      <View style={{ gap: 24 }}>
        {adminSections.map((section) => (
          <View key={section.title} style={{ gap: 10 }}>
            <Text className="admin-section__title" accessibilityRole="header">{section.title}</Text>
            <TileGrid columns={compact ? 2 : 3} tileClass={tile}>
              {section.links.map((link) => (
                <PressableScale key={link.label} onPress={() => router.push(link.href)} className={tile} accessibilityRole="button" accessibilityLabel={`${link.label}. ${link.line}`}>
                  <View className="admin-tile__icon"><SymbolView name={link.icon} size={18} tintColor={colors.primaryText} /></View>
                  <Text className="admin-tile__label" numberOfLines={2}>{link.label}</Text>
                </PressableScale>
              ))}
            </TileGrid>
          </View>
        ))}
      </View>
    </AdminScreen>
  );
}
