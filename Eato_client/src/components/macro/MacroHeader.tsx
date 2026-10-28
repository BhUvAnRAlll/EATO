import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { colors } from "@/theme";

type MacroHeaderProps = { title: string; subtitle?: string; right?: ReactNode };

// The header row every pushed Macro screen draws itself: back chevron, centred title (with
// an optional line under it), and a same-width slot on the right so the title stays centred
export function MacroHeader({ title, subtitle, right }: MacroHeaderProps) {
  const back = () => (router.canGoBack() ? router.back() : router.replace("/macro"));
  return (
    <View className="min-h-12 flex-row items-center px-5">
      <View className="w-11">
        <Pressable onPress={back} hitSlop={12} className="h-11 w-11 justify-center" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
        </Pressable>
      </View>
      <View className="flex-1 items-center">
        <Text className="type-subhead text-forest-ink" numberOfLines={1}>{title}</Text>
        {subtitle && <Text className="home__note" numberOfLines={1}>{subtitle}</Text>}
      </View>
      <View className="w-11 items-end">{right}</View>
    </View>
  );
}
