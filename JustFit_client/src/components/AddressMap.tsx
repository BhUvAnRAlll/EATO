import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import MapView, { PROVIDER_GOOGLE, type Region } from "react-native-maps";

import type { LatLng } from "@/lib/addressRules";
import { useThemeColors } from "@/theme";

// Google Maps on both phones (the keys from app.config.ts); without the Android key the map would
// crash, so Android shows the card below instead, and without the iOS key iOS draws Apple Maps.
const extra = Constants.expoConfig?.extra;
const googleOnIos = Platform.OS === "ios" && extra?.googleMapsIos === true;
export const addressMapAvailable = Platform.OS === "ios" || (Platform.OS === "android" && extra?.googleMapsAndroid === true);

// India, when there is nowhere better to start
const INDIA: Region = { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 22, longitudeDelta: 22 };
// About a street's width across, close enough to place the pin on a building
const STREET = 0.004;
const regionAt = (at: LatLng): Region => ({ ...at, latitudeDelta: STREET, longitudeDelta: STREET });

// `focus` moves the map (search, GPS, a saved address); `key` changes for every move, even to the
// same place twice
export type MapFocus = { at: LatLng; key: number } | null;

// Select Delivery Location's map: the pin stays in the middle and the map moves under it, so a
// drag anywhere places it. `onSettle` gets the middle once the map stops; `onMove` when a drag starts.
export function AddressMap({ start, focus, onMove, onSettle }: { start: LatLng | null; focus: MapFocus; onMove: () => void; onSettle: (at: LatLng) => void }) {
  const colors = useThemeColors();
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);

  useEffect(() => {
    if (focus) map.current?.animateToRegion(regionAt(focus.at), 450);
  }, [focus]);

  if (!addressMapAvailable) return <MapUnavailable />;
  return (
    <View style={StyleSheet.absoluteFill} accessible accessibilityLabel="Map. Move it to place the pin on your building." accessibilityHint="The address under the pin shows below the map">
      <MapView
        ref={map}
        provider={Platform.OS === "android" || googleOnIos ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFill}
        initialRegion={start ? regionAt(start) : INDIA}
        onMapReady={() => setReady(true)}
        onRegionChange={() => {
          if (movingRef.current) return;
          movingRef.current = true;
          setMoving(true);
          onMove();
        }}
        // Every stop names the place under the pin: a drag, or the camera sent by search or GPS
        onRegionChangeComplete={(region) => {
          movingRef.current = false;
          setMoving(false);
          onSettle({ latitude: region.latitude, longitude: region.longitude });
        }}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      />
      {!ready && (
        <View className="address-map__loading" pointerEvents="none">
          <ActivityIndicator color={colors.leaf} />
          <Text className="type-caption text-muted">Loading the map…</Text>
        </View>
      )}
      <CenterPin lifted={moving} />
    </View>
  );
}

// The pin in the middle: lifts while the map moves, with its shadow on the ground
function CenterPin({ lifted }: { lifted: boolean }) {
  return (
    <View className="address-pin" pointerEvents="none">
      <View style={{ transform: [{ translateY: lifted ? -10 : 0 }] }} className="items-center">
        <View className="address-pin__head">
          <View className="address-pin__dot" />
        </View>
        <View className="address-pin__stem" />
      </View>
      <View className="address-pin__shadow" />
    </View>
  );
}

function MapUnavailable() {
  return (
    <View className="address-map__loading">
      <Text className="card__title text-center">Map not available in this build</Text>
      <Text className="type-caption text-muted text-center">Use your current location or search for your area. You type the address on the next screen.</Text>
    </View>
  );
}
