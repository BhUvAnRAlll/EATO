import { useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";

import { images } from "@/constants/images";
import { onboardingSlides, type OnboardingSlide } from "@/data/onboarding";
import { colors } from "@/theme";

export default function Onboarding() {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<OnboardingSlide>>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === onboardingSlides.length - 1;

  const goToSlide = (slideIndex: number) => {
    listRef.current?.scrollToOffset({ offset: width * slideIndex, animated: true });
    setIndex(slideIndex);
  };

  const handleSkip = () => goToSlide(onboardingSlides.length - 1);

  const handleGetStarted = () => {
    // TODO: open the goal screen (next onboarding step) once it's built.
    if (isLast) return;
    goToSlide(index + 1);
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="dark" />

      {/* Header: mascot logo + app name, Skip */}
      <View className="flex-row items-center justify-between px-5">
        <View className="items-center">
          <Image source={images.mascotLogo} className="h-12 w-20" resizeMode="contain" />
          <Text className="onboarding__brand">EATO</Text>
          <View className="flex-row items-center gap-0.5">
            <View className="h-px w-1.5 bg-success" />
            <Text className="onboarding__brand-tagline">Fuel your fitness</Text>
            <View className="h-px w-1.5 bg-success" />
          </View>
        </View>

        <Pressable onPress={handleSkip} hitSlop={12} className="pt-3">
          <Text className="onboarding__skip">Skip</Text>
        </Pressable>
      </View>

      {/* Slides */}
      <FlatList
        ref={listRef}
        data={onboardingSlides}
        keyExtractor={(slide) => slide.id}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        className="flex-1"
        renderItem={({ item, index: slideIndex }) => (
          <View style={{ width }} className="pt-3.5">
            {/* Hero card */}
            <View className="onboarding__hero mx-5">
              <Image source={item.image} className="absolute inset-0 h-full w-full" resizeMode="cover" />

              <View className="flex-row items-center justify-between p-3">
                <View className="onboarding__tag">
                  <SymbolView name={item.tag.icon} size={18} tintColor={colors.ink} />
                  <Text className="onboarding__tag-label">{item.tag.label}</Text>
                </View>
                <View className="onboarding__counter">
                  <Text className="onboarding__counter-label">
                    {slideIndex + 1} / {onboardingSlides.length}
                  </Text>
                </View>
              </View>

              <View className="mt-auto flex-row justify-center gap-1.5 px-2 pb-3">
                {item.features.map((feature) => (
                  <View key={feature.label} className="onboarding__chip">
                    <SymbolView name={feature.icon} size={15} tintColor={colors.white} />
                    <Text className="onboarding__chip-label" numberOfLines={1}>
                      {feature.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Copy */}
            <View className="px-5 pt-7">
              <Text className="onboarding__overline">{item.overline}</Text>
              <Text className="onboarding__title mt-3">{item.title}</Text>
              <Text className="onboarding__body mt-4">{item.body}</Text>
              <View className="mt-8 flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5">
                  {onboardingSlides.map((slide, dotIndex) => (
                    <View
                      key={slide.id}
                      className={
                        dotIndex === slideIndex
                          ? "onboarding__dot onboarding__dot--active"
                          : "onboarding__dot"
                      }
                    />
                  ))}
                </View>
                <Text className="onboarding__footer">{item.footer}</Text>
              </View>
            </View>
          </View>
        )}
      />

      {/* Get Started */}
      <View className="px-5 pb-2 pt-5">
        <Pressable onPress={handleGetStarted} className="btn btn--primary btn--lg gap-2">
          <Text className="btn__label btn__label--primary text-[16px]">Get Started</Text>
          <SymbolView
            name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
            size={18}
            tintColor={colors.white}
          />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
