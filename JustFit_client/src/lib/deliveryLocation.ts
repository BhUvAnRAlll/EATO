import { Linking, Platform } from "react-native";
import * as Location from "expo-location";

import { placeFromGeocode, unnamedPlace, type LatLng, type PickedPlace } from "@/lib/addressRules";

// The phone's location for delivery addresses: permission while the app is in use only, asked
// for when the member taps "Use current location" (never on its own). iOS can't switch location
// services on for the member, so it only says how; Android shows its own "Turn on location"
// prompt. Every failure is one plain line, plus whether Settings is the way out.
export type FindResult = { ok: true; at: LatLng } | { ok: false; message: string; settings: boolean };

const TIMEOUT_MS = 15_000;

// Whether the member already allowed location (so the map may start where they are, no prompt)
export async function locationAllowed(): Promise<boolean> {
  try {
    return (await Location.getForegroundPermissionsAsync()).status === "granted";
  } catch {
    return false;
  }
}

export async function findMe(): Promise<FindResult> {
  let permission: Location.LocationPermissionResponse;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch {
    return { ok: false, message: "We couldn't use your phone's location. Search for your area instead.", settings: false };
  }
  if (permission.status !== "granted") {
    return permission.canAskAgain
      ? { ok: false, message: "Allow location to find your address, or search for your area instead.", settings: false }
      : {
          ok: false,
          settings: true,
          message: Platform.OS === "ios"
            ? "Location is off for justFit. Open Settings › justFit › Location and pick \"While Using the App\"."
            : "Location is off for justFit. Open Settings › Permissions › Location and allow it while using the app.",
        };
  }
  if (!(await Location.hasServicesEnabledAsync().catch(() => true))) {
    if (Platform.OS === "android") {
      // Android's own "Turn on location?" prompt; refusing it throws
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        return { ok: false, message: "Your phone's location is off. Turn it on to find your address, or search instead.", settings: false };
      }
    } else {
      return { ok: false, message: "Location Services are off. Turn them on in Settings › Privacy & Security, or search instead.", settings: false };
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS); });
  try {
    const position = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]);
    if (position !== "timeout") return { ok: true, at: { latitude: position.coords.latitude, longitude: position.coords.longitude } };
    // Indoors the first fix can take a while: the last known one is close enough to start from
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
    if (last) return { ok: true, at: { latitude: last.coords.latitude, longitude: last.coords.longitude } };
    return { ok: false, message: "Finding your location is taking too long. Move the pin or search instead.", settings: false };
  } catch {
    return { ok: false, message: "We couldn't find your location. Move the pin or search for your area.", settings: false };
  } finally {
    clearTimeout(timer);
  }
}

export const openLocationSettings = () => Linking.openSettings().catch(() => {});

// The place at a point, named by the phone's own geocoder (free, no key). Offline or on the web
// it can't be named: the coordinates are kept and the member types the address.
export async function nameOf(at: LatLng): Promise<{ place: PickedPlace; named: boolean }> {
  if (Platform.OS === "web") return { place: unnamedPlace(at), named: false };
  try {
    const [found] = await Location.reverseGeocodeAsync(at);
    return found ? { place: placeFromGeocode(found, at), named: true } : { place: unnamedPlace(at), named: false };
  } catch {
    return { place: unnamedPlace(at), named: false };
  }
}

// Places matching what was typed (the phone's geocoder: it finds a place once the text is whole,
// e.g. "Batawadi, Tumakuru"), each named for the results list. Android needs the permission first.
export type SearchResult = { ok: true; places: PickedPlace[] } | { ok: false; message: string };
export async function searchPlaces(text: string): Promise<SearchResult> {
  if (Platform.OS === "web") return { ok: false, message: "Search works in the justFit app on your phone." };
  try {
    if (Platform.OS === "android") await Location.requestForegroundPermissionsAsync();
    const found = (await Location.geocodeAsync(text)).slice(0, 5);
    if (found.length === 0) return { ok: false, message: "No place found. Try the area and city, like \"Batawadi, Tumakuru\"." };
    const places = await Promise.all(found.map(async (f) => (await nameOf({ latitude: f.latitude, longitude: f.longitude })).place));
    // The same place found twice (two spellings) is listed once
    return { ok: true, places: places.filter((p, i) => places.findIndex((q) => q.formattedAddress === p.formattedAddress) === i) };
  } catch {
    return { ok: false, message: "Search isn't working right now. Check your connection, or move the pin." };
  }
}
