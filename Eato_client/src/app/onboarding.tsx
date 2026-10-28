import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { BrandWordmark } from "@/components/BrandWordmark";
import { onboardingSlides, type OnboardingSlide } from "@/data/onboarding";
import { colors } from "@/theme";

// Slides advance on their own this often (ms), always moving forward
const AUTO_ADVANCE_MS = 1800;
// Roughly how long the slide animation takes (ms)
const SLIDE_ANIMATION_MS = 500;
// Space between the food image and the screen edges
const ART_PADDING = 20;

// Endless forward loop: a copy of slide 1 sits after the last slide. We slide
// forward onto the copy, then jump (without animation) to the real slide 1.
const SLIDE_COUNT = onboardingSlides.length;
const loopSlides = [...onboardingSlides, { ...onboardingSlides[0], id: `${onboardingSlides[0].id}-loop` }];

export default function Onboarding() {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<OnboardingSlide>>(null);
  const [index, setIndex] = useState(0);
  // Each slide is given the list's measured height: a horizontal list doesn't stretch its
  // items vertically on every platform, and the art's flex: 1 needs a definite column height
  const [listHeight, setListHeight] = useState(0);

  const artWidth = width - ART_PADDING * 2;
  // Short screens (e.g. 320×568): the measured slide height can't hold the full-size title
  // and a decent picture, so the type steps down and the art is given a fixed share of
  // the height (never under 120pt) instead of whatever the text leaves over
  const short = listHeight > 0 && listHeight < 430;

  const goToSlide = (slideIndex: number) => {
    listRef.current?.scrollToOffset({ offset: width * slideIndex, animated: true });
    setIndex(slideIndex);
  };

  // Auto-advance. Restarts whenever the slide changes, so a manual swipe
  // gets a full interval before the next move.
  useEffect(() => {
    // On the copy of slide 1: once the animation ends, jump to the real slide 1
    if (index === SLIDE_COUNT) {
      const timer = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        setIndex(0);
      }, SLIDE_ANIMATION_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => goToSlide(index + 1), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  });

  const goToSignUp = () => router.push("/sign-up");

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <View className="flex-1 overflow-hidden bg-cream">
      <StatusBar style="dark" />
      <View className="onboarding__circle" />

      <SafeAreaView style={{ flex: 1 }}>
        {/* Wordmark */}
        <View className="mt-2.5 px-9">
          <BrandWordmark width={194} large />
        </View>

        {/* Slides: title, subtitle and food art swipe together */}
        <FlatList
          ref={listRef}
          data={loopSlides}
          keyExtractor={(slide) => slide.id}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}
          className="flex-1"
          renderItem={({ item }) => (
            <View style={{ width, height: listHeight > 0 ? listHeight : undefined }} className="flex-1">
              <View className={short ? "px-9 pt-4" : "px-9 pt-7"}>
                <Text className="onboarding__title" style={short ? { fontSize: 30, lineHeight: 34 } : undefined}>
                  {item.title}
                </Text>
                <Text className={short ? "onboarding__subtitle mt-2" : "onboarding__subtitle mt-3"} style={short ? { fontSize: 15, lineHeight: 20 } : undefined}>
                  {item.subtitle}
                </Text>
              </View>
              <Image
                source={item.art}
                contentFit="contain"
                contentPosition="top"
                style={{
                  width: artWidth,
                  marginTop: -item.artOverlap,
                  marginHorizontal: ART_PADDING,
                  ...(short
                    ? { height: Math.max(120, Math.min(Math.round(artWidth / item.artRatio), Math.round(listHeight * 0.45))) }
                    : { flex: 1, maxHeight: artWidth / item.artRatio }),
                }}
              />
            </View>
          )}
        />

        {/* Dots */}
        <View className="flex-row justify-center gap-6 pt-2">
          {onboardingSlides.map((slide, dotIndex) => (
            <View
              key={slide.id}
              className={dotIndex === index % SLIDE_COUNT ? "onboarding__dot onboarding__dot--active" : "onboarding__dot"}
            />
          ))}
        </View>

        <View className="px-6 pb-3 pt-4">
          <Pressable onPress={goToSignUp} className="onboarding__button">
            <Text className="onboarding__button-label">Get Started</Text>
            <SymbolView
              name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
              size={18}
              tintColor={colors.white}
            />
          </Pressable>

          <Text className="onboarding__footer mt-6 text-center">
            {"Already have an account?   "}
            <Text className="onboarding__footer-link" onPress={() => router.push("/sign-in")}>
              Log in
            </Text>
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
