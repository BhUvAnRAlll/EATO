import { Text, View } from "react-native";
import { Image } from "expo-image";

import { images } from "@/constants/images";

// Width ÷ height of the justFit logo image (the JF mark above the JUSTFIT word)
export const WORDMARK_RATIO = 600 / 481;

type BrandWordmarkProps = {
  // Width of the logo in pt
  width?: number;
  // Larger tagline, for onboarding
  large?: boolean;
};

// The justFit logo with the "BALANCED MEALS • STRONGER YOU" tagline
export function BrandWordmark({ width = 96, large = false }: BrandWordmarkProps) {
  return (
    <View>
      <Image
        source={images.justfitLogo}
        contentFit="contain"
        style={{ width, height: width / WORDMARK_RATIO }}
      />
      <Text className={large ? "brand__tagline brand__tagline--lg mt-1" : "brand__tagline mt-1"}>
        Balanced meals <Text className="brand__tagline-dot">•</Text> Stronger you
      </Text>
    </View>
  );
}
