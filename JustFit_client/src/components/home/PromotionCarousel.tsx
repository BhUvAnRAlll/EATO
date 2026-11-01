import { useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { PromotionSlide } from "@/components/home/PromotionSlide";
import type { Promotion } from "@/data/home";
import { useThemeColors } from "@/theme";

type PromotionCarouselProps = {
  promotions: Promotion[];
  // The slide width (the screen width: the hero spans edge to edge)
  width: number;
  onOpen: (destination: string) => void;
};

// Roughly how long the slide animation takes (ms)
const SLIDE_ANIMATION_MS = 450;

// Auto-rotating hero. Each slide stays for its own rotationIntervalSeconds, then the
// list slides forward. Endless loop: a copy of slide 1 sits after the last slide; after
// sliding onto it we jump (without animation) to the real slide 1. A manual swipe
// restarts the wait. Rotation pauses while the app is in the background.
export function PromotionCarousel({ promotions, width, onOpen }: PromotionCarouselProps) {
  const colors = useThemeColors();
  const height = Math.round(Math.min(300, Math.max(250, width * 0.62)));
  const count = promotions.length;
  const slides = count > 1 ? [...promotions, promotions[0]] : promotions;
  const listRef = useRef<FlatList<Promotion>>(null);
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [inBackground, setInBackground] = useState(AppState.currentState !== "active");

  // A different set of promotions (admin changes, first load): start from the first slide.
  // The list is keyed by the ids, so it remounts at offset 0; the index follows during render.
  const ids = promotions.map((promotion) => promotion.id).join(",");
  const [shownIds, setShownIds] = useState(ids);
  if (shownIds !== ids) {
    setShownIds(ids);
    setIndex(0);
  }

  // Keep the current slide in view if the width changes (rotation, split view)
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: width * index, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setInBackground(state !== "active"));
    return () => subscription.remove();
  }, []);

  // One timer at a time: it is cleared whenever the slide, the pause state or the data changes
  useEffect(() => {
    if (count < 2 || dragging || inBackground) return;
    if (index >= count) {
      // On the copy of slide 1: once the animation ends, jump to the real slide 1
      const timer = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        setIndex(0);
      }, SLIDE_ANIMATION_MS);
      return () => clearTimeout(timer);
    }
    const seconds = promotions[index]?.rotationIntervalSeconds ?? 2;
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: width * (index + 1), animated: true });
      setIndex(index + 1);
    }, Math.max(1, seconds) * 1000);
    return () => clearTimeout(timer);
  }, [index, count, dragging, inBackground, width, promotions]);

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setDragging(false);
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  if (count === 0) {
    return (
      <View className="home__empty my-2">
        <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={22} tintColor={colors.leaf} />
        <Text className="card__title">New offers coming soon</Text>
        <Text className="placeholder__text">Check back for chef-prepared meal deals.</Text>
      </View>
    );
  }

  return (
    <View>
      <FlatList
        key={ids}
        ref={listRef}
        data={slides}
        keyExtractor={(slide, slideIndex) => `${slide.id}-${slideIndex}`}
        horizontal
        pagingEnabled
        bounces={false}
        scrollEnabled={count > 1}
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => setDragging(true)}
        onMomentumScrollEnd={handleScrollEnd}
        getItemLayout={(_, slideIndex) => ({ length: width, offset: width * slideIndex, index: slideIndex })}
        renderItem={({ item }) => <PromotionSlide promotion={item} width={width} height={height} onPress={onOpen} />}
        accessibilityRole="list"
      />

      {/* One dot per promotion; the copy of slide 1 lights the first dot */}
      {count > 1 && (
        <View className="flex-row justify-center gap-1.5 pt-3">
          {promotions.map((promotion, dotIndex) => (
            <View key={promotion.id} className={dotIndex === index % count ? "home__dot home__dot--active" : "home__dot"} />
          ))}
        </View>
      )}
    </View>
  );
}
