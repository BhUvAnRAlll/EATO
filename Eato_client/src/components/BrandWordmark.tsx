import { Text, View } from "react-native";
import { Image } from "expo-image";

import { images } from "@/constants/images";

// Width ÷ height of the wordmark image
export const WORDMARK_RATIO = 252 / 116;

type BrandWordmarkProps = {
  // Width of the "Eat" logo in pt
  width?: number;
  // Larger tagline, for onboarding
  large?: boolean;
};

// "Eat" logo with the "BALANCED MEALS • STRONGER YOU" tagline
export function BrandWordmark({ width = 116, large = false }: BrandWordmarkProps) {
  return (
    <View>
      <Image
        source={images.eatoWordmark}
        contentFit="contain"
        style={{ width, height: width / WORDMARK_RATIO, marginLeft: -width * 0.03 }}
      />
      <Text className={large ? "brand__tagline brand__tagline--lg mt-1" : "brand__tagline mt-1"}>
        Balanced meals <Text className="brand__tagline-dot">•</Text> Stronger you
      </Text>
    </View>
  );
}
