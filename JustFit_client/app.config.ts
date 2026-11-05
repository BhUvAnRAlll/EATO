import { type ConfigContext, type ExpoConfig } from "expo/config";

// All server work (profile, report reading, roles) lives in JustFit_server; the app has no
// Expo API routes, so no server origin is needed here.
//
// The values that must not be committed: the Google Maps keys for the gym portal's attendance
// location map. Put GOOGLE_MAPS_ANDROID_API_KEY and GOOGLE_MAPS_IOS_API_KEY in JustFit_client/.env
// (git-ignored) or your shell, then run `npx expo prebuild --clean` before building. Restrict each
// key in Google Cloud: the Android one to the Maps SDK for Android, this app's package name and
// the build's SHA-1; the iOS one to the Maps SDK for iOS and this app's bundle id. Without the
// Android key, Android shows the location form without the map; without the iOS key, iOS draws
// Apple Maps instead of Google Maps.
export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) throw new Error("Expo config must define both name and slug.");
  const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "";
  const iosMapsKey = process.env.GOOGLE_MAPS_IOS_API_KEY ?? "";
  // Only with a key: the plugin then adds the Google Maps SDK to the iOS build
  const mapsPlugin = { androidGoogleMapsApiKey: androidMapsKey, ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}) };
  return {
    ...config,
    name: config.name,
    slug: config.slug,
    plugins: [...(config.plugins ?? []), ["react-native-maps", mapsPlugin]],
    extra: { ...config.extra, googleMapsAndroid: androidMapsKey.length > 0, googleMapsIos: iosMapsKey.length > 0 },
  };
};
