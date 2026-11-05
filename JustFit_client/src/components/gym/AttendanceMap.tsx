import { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type MapPressEvent, type MarkerDragStartEndEvent } from "react-native-maps";

import { GymIcon } from "@/components/gym/GymIcon";
import { useThemeColors } from "@/theme";

export type LatLng = { latitude: number; longitude: number };

// Android draws Google Maps, which needs the key from app.config.ts in the build (without one the
// map would crash, so the form shows without it); iOS draws Apple Maps, which needs no key.
export const mapAvailable = Platform.OS === "ios" || (Platform.OS === "android" && Constants.expoConfig?.extra?.googleMapsAndroid === true);

// India, when nothing is picked yet
const INDIA = { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 22, longitudeDelta: 22 };
// Enough around the circle to see it whole
const regionAround = (place: LatLng, radiusM: number) => {
  const delta = Math.max(0.004, (radiusM * 4) / 111_000);
  return { ...place, latitudeDelta: delta, longitudeDelta: delta };
};

// The attendance location picker: tap the map or drag the pin to the entrance; the circle is the
// radius members must be within. `focus` is set when the place came from search, GPS or typing,
// so the map moves there (a tap on the map doesn't move the camera).
export type MapFocus = { place: LatLng; radiusM: number } | null;
export function AttendanceMap({ place, radiusM, onPick, focus }: { place: LatLng | null; radiusM: number; onPick: (place: LatLng) => void; focus: MapFocus }) {
  const colors = useThemeColors();
  const map = useRef<MapView>(null);

  useEffect(() => {
    if (focus) map.current?.animateToRegion(regionAround(focus.place, focus.radiusM), 450);
  }, [focus]);

  if (!mapAvailable) return <MapUnavailable />;
  return (
    <View className="gym-map" accessibilityLabel="Map: tap the gym's entrance or drag the pin. The circle shows the attendance radius.">
      <MapView
        ref={map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFill}
        initialRegion={place ? regionAround(place, radiusM) : INDIA}
        onPress={(e: MapPressEvent) => onPick(e.nativeEvent.coordinate)}
        showsUserLocation
        toolbarEnabled={false}
      >
        {place && (
          <>
            <Circle center={place} radius={radiusM} strokeColor={colors.gymPrimary} strokeWidth={2} fillColor={`${colors.gymPrimary}29`} />
            <Marker coordinate={place} draggable pinColor={colors.gymPrimary} onDragEnd={(e: MarkerDragStartEndEvent) => onPick(e.nativeEvent.coordinate)} />
          </>
        )}
      </MapView>
    </View>
  );
}

function MapUnavailable() {
  const colors = useThemeColors();
  return (
    <View className="gym-map gym-map--empty">
      <GymIcon name="map-pin" size={24} color={colors.gymPrimary} />
      <Text className="gym-tx__name text-center">Map not available in this build</Text>
      <Text className="gym-tx__meta text-center">{"Use your current location at the gym's entrance, or type the latitude and longitude below."}</Text>
    </View>
  );
}
