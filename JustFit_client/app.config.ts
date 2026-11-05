import { type ConfigContext, type ExpoConfig } from "expo/config";

// All server work (profile, report reading, roles) lives in JustFit_server; the app has no
// Expo API routes, so no server origin is needed here.
//
// The one value that must not be committed: the Google Maps key for Android (the gym portal's
// attendance location map). Set GOOGLE_MAPS_ANDROID_API_KEY in your shell before
// `npm run android` / `npm run build:android`, and restrict the key in Google Cloud to the Maps
// SDK for Android and this app's package name. Without it, Android shows the location form
// without the map (iOS uses Apple Maps, which needs no key).
export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) throw new Error("Expo config must define both name and slug.");
  const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "";
  return {
    ...config,
    name: config.name,
    slug: config.slug,
    plugins: [...(config.plugins ?? []), ["react-native-maps", { androidGoogleMapsApiKey: androidMapsKey }]],
    extra: { ...config.extra, googleMapsAndroid: androidMapsKey.length > 0 },
  };
};
