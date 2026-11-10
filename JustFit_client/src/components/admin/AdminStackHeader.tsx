import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type AdminStackHeaderProps = {
  title: string;
  // One line under the title (a branch, an account's kind)
  subtitle?: string;
  // A small control on the right: a 44 pt round button (Budget, Export)
  right?: ReactNode;
  // Where Back goes when there is nothing to go back to (opened from a link)
  fallback?: Href;
  // Replaces the default Back (router.back, else `fallback`)
  onBack?: () => void;
};

// The header of every Super Admin screen under a tab: the round Back, then the title large and on
// the left (as on the tabs' own header), an optional line under it and an action on the right.
export function AdminStackHeader({ title, subtitle, right, fallback = "/admin", onBack }: AdminStackHeaderProps) {
  const colors = useThemeColors();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace(fallback)));
  return (
    <View className="admin-stack-header">
      <PressableScale onPress={back} scaleTo={0.92} hitSlop={6} className="admin-header__button" accessibilityRole="button" accessibilityLabel="Back">
        <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
      </PressableScale>
      <View className="min-w-0 flex-1">
        <Text className="admin-stack-header__title" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text className="meta-text" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}
