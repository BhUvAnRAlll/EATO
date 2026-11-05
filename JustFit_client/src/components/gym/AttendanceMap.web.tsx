import { Text, View } from "react-native";

import { GymIcon } from "@/components/gym/GymIcon";
import { useThemeColors } from "@/theme";

export type LatLng = { latitude: number; longitude: number };
export type MapFocus = { place: LatLng; radiusM: number } | null;

// The web build has no native map (react-native-maps is phones only): the picker's place and
// radius are shown in words, and set with "Use my current location" or the coordinates.
export const mapAvailable = false;

export function AttendanceMap({ place, radiusM }: { place: LatLng | null; radiusM: number; onPick: (place: LatLng) => void; focus: MapFocus }) {
  const colors = useThemeColors();
  return (
    <View className="gym-map gym-map--empty">
      <GymIcon name="map-pin" size={24} color={colors.gymPrimary} />
      <Text className="gym-tx__name text-center">{place ? `${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}` : "No location picked yet"}</Text>
      <Text className="gym-tx__meta text-center">
        {place ? `Members must be within ${radiusM} m of this point. ` : ""}The map opens in the justFit app on your phone; here, use your current location or type the coordinates.
      </Text>
    </View>
  );
}
