import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "@/components/SymbolView";

import type { PromotionFields } from "@/data/home";
import { resolveImage } from "@/lib/home";
import { colors } from "@/theme";

type PromotionSlideProps = {
  promotion: PromotionFields;
  width: number;
  height: number;
  // Called with the destination key of the button that was pressed
  onPress?: (destination: string) => void;
};

// Share of the slide the text column takes. The photo fills the whole slide behind it,
// anchored to the image side, so a wide photo with an empty area (the usual hero shot)
// shows its food on one side and the text and buttons on the other.
const TEXT_SHARE = 0.56;
// Below this width the type steps down a size and the text column widens a little
const COMPACT_WIDTH = 360;

// One promotion: eyebrow, headline (last word in green), description and the button(s)
// over the empty side of the food photo. Also used by the admin preview.
export function PromotionSlide({ promotion, width, height, onPress }: PromotionSlideProps) {
  const imageLeft = promotion.imagePosition === "left";
  const centered = promotion.textAlign === "center";
  const textColor = promotion.textColor ?? undefined;
  const compact = width < COMPACT_WIDTH;
  const textShare = compact ? 0.58 : TEXT_SHARE;
  // Narrow phones crop the photo more, so its food would reach under the text: let the
  // photo's box run past the slide's edge on the food side, which pushes the food outward
  // and keeps the text on the plain area
  const overhang = compact ? -Math.round(width * 0.18) : 0;
  // A soft halo in the page colour keeps the text readable where it meets the food on
  // narrow phones; on the photo's plain area it is invisible. Skipped for custom colours.
  const halo = textColor ? undefined : { textShadowColor: "rgba(253, 250, 244, 0.95)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 };
  const words = promotion.headline.trim().split(/\s+/);
  const lastWord = words.pop();

  return (
    <View
      style={{ width, height, backgroundColor: promotion.backgroundColor ?? undefined }}
      className={imageLeft ? "flex-row-reverse overflow-hidden" : "flex-row overflow-hidden"}
    >
      <View
        style={{ width: width * textShare, alignItems: centered ? "center" : "flex-start" }}
        className={imageLeft ? "justify-center py-3 pr-5 pl-2" : "justify-center py-3 pl-5 pr-2"}
      >
        <Text className="home__eyebrow" style={[halo, textColor ? { color: textColor, opacity: 0.8 } : undefined]}>
          {promotion.eyebrow}
        </Text>
        <Text
          className="home__headline mt-2"
          style={[halo, centered && { textAlign: "center" }, compact && { fontSize: 22, lineHeight: 26 }, textColor ? { color: textColor } : undefined]}
          numberOfLines={3}
        >
          {words.join(" ")}
          {words.length > 0 ? " " : ""}
          <Text className={textColor ? undefined : "home__headline-accent"}>{lastWord}</Text>
        </Text>
        <Text
          className="home__lead mt-2"
          style={[halo, centered && { textAlign: "center" }, compact && { fontSize: 13, lineHeight: 18 }, textColor ? { color: textColor, opacity: 0.85 } : undefined]}
          numberOfLines={3}
        >
          {promotion.description}
        </Text>

        <View className="mt-4 flex-row flex-wrap items-center gap-2">
          <Pressable
            onPress={() => onPress?.(promotion.ctaDestination)}
            className="home__cta"
            accessibilityRole="button"
            accessibilityLabel={promotion.ctaLabel}
          >
            <Text className="home__cta-label">{promotion.ctaLabel}</Text>
            <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={18} tintColor={colors.white} />
          </Pressable>
          {promotion.secondaryCtaLabel && promotion.secondaryCtaDestination && (
            <Pressable
              onPress={() => onPress?.(promotion.secondaryCtaDestination ?? "")}
              className="home__cta home__cta--secondary"
              accessibilityRole="button"
            >
              <Text className="home__cta-label home__cta-label--secondary">{promotion.secondaryCtaLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Image
        source={resolveImage(promotion.imageUrl)}
        contentFit="cover"
        contentPosition={imageLeft ? "left" : "right"}
        accessibilityLabel={promotion.imageAlt ?? undefined}
        style={{ position: "absolute", top: 0, bottom: 0, left: imageLeft ? overhang : 0, right: imageLeft ? 0 : overhang, zIndex: -1 }}
      />
    </View>
  );
}
