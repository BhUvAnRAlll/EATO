import { memo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";

import { IconButton } from "@/components/IconButton";
import { SymbolView } from "@/components/SymbolView";
import { images } from "@/constants/images";
import type { Place } from "@/lib/workoutApi";
import { useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";

type FitnessHeaderProps = {
  place: Place;
  // The place being switched to while today's session is set up for it
  switching: Place | null;
  onPlace: (place: Place) => void;
  onLocation: () => void;
  onSearch: () => void;
};

const PLACES: { id: Place; label: string; icon: Icon }[] = [
  { id: "home", label: "AT HOME", icon: { ios: "house.fill", android: "home", web: "home" } },
  { id: "center", label: "AT CENTER", icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } },
];

// Width ÷ height of the JUSTFIT word (images.justfitWordmark)
const WORDMARK_RATIO = 1200 / 213;

// The Fitness tab's fixed header: the justFit word over the title, the location and search
// buttons, and the AT HOME / AT CENTER switch (red when on), which picks the programs shown and
// where today's session is done.
function FitnessHeaderBase({ place, switching, onPlace, onLocation, onSearch }: FitnessHeaderProps) {
  const colors = useThemeColors();
  return (
    <View className="fitness-header">
      <View className="flex-row items-center gap-2">
        <View className="flex-1 gap-1">
          <Image source={images.justfitWordmark} contentFit="contain" style={{ width: 18 * WORDMARK_RATIO, height: 18 }} accessibilityLabel="justFit" />
          <Text className="fitness-header__title" accessibilityRole="header">Fitness</Text>
        </View>
        <IconButton icon={{ ios: "location", android: "location_on", web: "location_on" }} label="Where you train: equipment at home and at your center" onPress={onLocation} />
        <IconButton icon={{ ios: "magnifyingglass", android: "search", web: "search" }} label="Search programs and categories" onPress={onSearch} />
      </View>
      <View className="fitness-place" accessibilityRole="tablist">
        {PLACES.map((p) => {
          const on = (switching ?? place) === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => p.id !== place && onPlace(p.id)}
              disabled={switching !== null}
              className={on ? "fitness-place__tab fitness-place__tab--on" : "fitness-place__tab"}
              style={{ gap: 6 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled: switching !== null }}
              accessibilityLabel={p.id === "home" ? "At home" : "At center"}
            >
              {switching === p.id ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <SymbolView name={p.icon} size={15} tintColor={on ? colors.onPrimary : colors.muted} />}
              <Text className={on ? "fitness-place__label fitness-place__label--on" : "fitness-place__label"}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const FitnessHeader = memo(FitnessHeaderBase);
