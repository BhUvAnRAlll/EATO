import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type ScreenHeaderProps = {
  title: string;
  // One line under the title, centred across the whole header
  subtitle?: string;
  // Something small on the right (a 44 pt slot, so the title stays centred)
  right?: ReactNode;
  // Where Back goes when there is nothing to go back to (opened from a link)
  fallback?: Href;
  // Replaces the default Back (router.back, else `fallback`)
  onBack?: () => void;
  // false on a tab screen: the tab bar is the way around
  showBack?: boolean;
};

// The one header of the member app's pushed screens: a 44 pt outlined round Back, the title
// centred on it, an optional line under both, on the page colour with a little room below, so
// content scrolling underneath never shows through or touches the title.
export function ScreenHeader({ title, subtitle, right, fallback = "/", onBack, showBack = true }: ScreenHeaderProps) {
  const colors = useThemeColors();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace(fallback)));
  return (
    <View className="screen-header">
      <View className="screen-bar">
        {showBack ? (
          <PressableScale onPress={back} scaleTo={0.92} hitSlop={6} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </PressableScale>
        ) : (
          <View className="screen-bar__spacer" />
        )}
        <Text className="screen-bar__title" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} accessibilityRole="header">
          {title}
        </Text>
        <View className="screen-bar__spacer items-end justify-center">{right}</View>
      </View>
      {subtitle ? <Text className="screen-header__subtitle" numberOfLines={2}>{subtitle}</Text> : null}
    </View>
  );
}
