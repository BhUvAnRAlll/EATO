import { Text, View } from "react-native";

import type { LatLng } from "@/lib/addressRules";

// The web build has no native map (react-native-maps is phones only): Select Delivery Location
// starts from the current location or a saved address, and the address is typed on the form.
export const addressMapAvailable = false;
export type MapFocus = { at: LatLng; key: number } | null;

export function AddressMap(_: { start: LatLng | null; focus: MapFocus; onMove: () => void; onSettle: (at: LatLng) => void }) {
  return (
    <View className="address-map__loading">
      <Text className="card__title text-center">The map opens in the justFit app</Text>
      <Text className="type-caption text-muted text-center">Here, use your current location, then type the address on the next screen.</Text>
    </View>
  );
}
