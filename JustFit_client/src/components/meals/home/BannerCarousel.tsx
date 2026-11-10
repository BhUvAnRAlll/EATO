import { useEffect, useRef, useState } from "react";
import { AppState, FlatList, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

// One slide of the promotional section: the Super Admin's banner, or a built-in promo (data/mealPromos.ts)
export type PromoSlide = { key: string; title: string; text: string | null; badge: string | null; cta: string; image: ImageSource | number | null; onPress: () => void };

// The promotional section (Zomato-style, under the search): big slides, swipe, or it moves on every
// 5 s (never with Reduce Motion, or while the app is in the background); dots under it show where it is
export function BannerCarousel({ banners, width }: { banners: PromoSlide[]; width: number }) {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const list = useRef<FlatList<PromoSlide>>(null);
  const [index, setIndex] = useState(0);
  const slide = width - 32;
  const step = slide + 12;

  useEffect(() => {
    if (reduceMotion || banners.length < 2) return;
    let active = AppState.currentState === "active";
    const sub = AppState.addEventListener("change", (s) => { active = s === "active"; });
    const timer = setInterval(() => {
      if (!active) return;
      setIndex((i) => {
        const next = (i + 1) % banners.length;
        list.current?.scrollToOffset({ offset: next * step, animated: true });
        return next;
      });
    }, 5000);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [banners.length, reduceMotion, step]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.max(0, Math.min(banners.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))));

  return (
    <View style={{ gap: 10 }}>
      <FlatList
        ref={list}
        data={banners}
        keyExtractor={(b) => b.key}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
        renderItem={({ item }) => (
          <PressableScale scaleTo={0.98} onPress={item.onPress} className="shop-banner" style={{ width: slide }} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.cta}`}>
            <View style={{ width: "100%", aspectRatio: 2 }}>
              {item.image ? <Image source={item.image} recyclingKey={item.key} contentFit="cover" transition={200} style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "70%" }} /> : null}
              {/* Dark on the left fading into the photo, so the words always read */}
              <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%" preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id={`shopBanner${item.key}`} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={colors.inverse} stopOpacity={1} />
                    <Stop offset="0.42" stopColor={colors.inverse} stopOpacity={0.96} />
                    <Stop offset="0.68" stopColor={colors.inverse} stopOpacity={0.25} />
                    <Stop offset="1" stopColor={colors.inverse} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#shopBanner${item.key})`} />
              </Svg>
              <View className="shop-banner__body">
                {item.badge ? <View className="shop-banner__badge"><Text className="shop-banner__badge-label" numberOfLines={1}>{item.badge}</Text></View> : null}
                <Text className="shop-banner__title" numberOfLines={2}>{item.title}</Text>
                {item.text ? <Text className="shop-banner__text" numberOfLines={2}>{item.text}</Text> : null}
                <View className="shop-banner__cta">
                  <Text className="shop-banner__cta-label">{item.cta}</Text>
                  <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={13} tintColor={colors.ink} />
                </View>
              </View>
            </View>
          </PressableScale>
        )}
      />
      {banners.length > 1 && (
        <View className="flex-row justify-center" style={{ gap: 6 }} accessibilityLabel={`Banner ${index + 1} of ${banners.length}`}>
          {banners.map((b, i) => <View key={b.key} className={i === index ? "shop-dot shop-dot--on" : "shop-dot"} />)}
        </View>
      )}
    </View>
  );
}
