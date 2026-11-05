import * as Location from "expo-location";

// One GPS reading for QR attendance (the member's scan, the admin's "use my current location").
// Permission is asked for here, while in use only. Every failure has its own plain line; the
// server still checks the reading's age, accuracy, mock flag and distance itself.
export type GpsReading = { latitude: number; longitude: number; accuracy: number; mocked: boolean; capturedAt: number };
export type GpsResult = { ok: true; reading: GpsReading } | { ok: false; reason: "denied" | "off" | "timeout" | "unavailable"; message: string; canAskAgain: boolean };

const TIMEOUT_MS = 20_000;

export async function readGps(): Promise<GpsResult> {
  let permission: Location.LocationPermissionResponse;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch {
    return { ok: false, reason: "unavailable", message: "We couldn't use your phone's location. Please try again.", canAskAgain: true };
  }
  if (permission.status !== "granted") {
    return {
      ok: false,
      reason: "denied",
      canAskAgain: permission.canAskAgain,
      message: permission.canAskAgain
        ? "justFit needs your location to confirm you're at the gym. Allow location when asked."
        : "Location is turned off for justFit. Open Settings and allow location while using the app.",
    };
  }
  if (!(await Location.hasServicesEnabledAsync().catch(() => true))) {
    return { ok: false, reason: "off", canAskAgain: true, message: "Your phone's location (GPS) is off. Turn it on and try again." };
  }
  // getCurrentPositionAsync has no timeout of its own: give up after 20 seconds
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS); });
  try {
    const position = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), timeout]);
    if (position === "timeout") {
      return { ok: false, reason: "timeout", canAskAgain: true, message: "Finding your location is taking too long. Step near a window or the entrance and try again." };
    }
    const accuracy = position.coords.accuracy;
    if (accuracy === null || !Number.isFinite(accuracy)) {
      return { ok: false, reason: "unavailable", canAskAgain: true, message: "Your phone couldn't tell how accurate its location is. Please try again." };
    }
    return {
      ok: true,
      reading: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Math.max(1, accuracy),
        mocked: position.mocked === true,
        capturedAt: Math.round(position.timestamp),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable", canAskAgain: true, message: "We couldn't find your location. Turn on GPS and try again." };
  } finally {
    clearTimeout(timer);
  }
}
