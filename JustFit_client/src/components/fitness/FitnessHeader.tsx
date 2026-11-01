import { memo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { IconButton } from "@/components/IconButton";
import { SymbolView } from "@/components/SymbolView";
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

// The Fitness tab's fixed header: the title with the location and search buttons, and the
// AT HOME / AT CENTER switch, which picks the programs shown and where today's session is done.
function FitnessHeaderBase({ place, switching, onPlace, onLocation, onSearch }: FitnessHeaderProps) {
  const colors = useThemeColors();
  return (
    <View className="fitness-header">
      <View className="flex-row items-center gap-2">
        <Text className="type-title flex-1 text-forest-ink" accessibilityRole="header">Fitness</Text>
        <IconButton icon={{ ios: "location", android: "location_on", web: "location_on" }} label="Where you train: equipment at home and at your center" onPress={onLocation} />
        <IconButton icon={{ ios: "magnifyingglass", android: "search", web: "search" }} label="Search programs and categories" onPress={onSearch} />
      </View>
      <View className="flex-row rounded-full bg-cream-tab p-1" accessibilityRole="tablist">
        {PLACES.map((p) => {
          const on = (switching ?? place) === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => p.id !== place && onPlace(p.id)}
              disabled={switching !== null}
              className={on ? "workout__tab workout__tab--active flex-row items-center justify-center" : "workout__tab flex-row items-center justify-center"}
              style={{ gap: 6 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled: switching !== null }}
              accessibilityLabel={p.id === "home" ? "At home" : "At center"}
            >
              {switching === p.id ? <ActivityIndicator size="small" color={colors.white} /> : <SymbolView name={p.icon} size={14} tintColor={on ? colors.white : colors.muted} />}
              <Text className="type-subhead" style={{ color: on ? colors.white : colors.muted, fontSize: 13, letterSpacing: 0.6 }}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const FitnessHeader = memo(FitnessHeaderBase);
