import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type DashedBlockProps = { icon: Icon; title: string; text: string; onPress?: () => void };

// The dashed "nothing here yet" block. Pressable only when there is something to do.
export function DashedBlock({ icon, title, text, onPress }: DashedBlockProps) {
  const body = (
    <>
      <SymbolView name={icon} size={24} tintColor={colors.leaf} />
      <Text className="card__title text-center">{title}</Text>
      <Text className="placeholder__text">{text}</Text>
    </>
  );
  if (!onPress) return <View className="home__empty mx-0">{body}</View>;
  return (
    <Pressable onPress={onPress} className="home__empty mx-0" accessibilityRole="button" accessibilityLabel={`${title}. ${text}`}>
      {body}
    </Pressable>
  );
}
