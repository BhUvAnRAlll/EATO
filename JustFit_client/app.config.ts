import { type ConfigContext, type ExpoConfig } from "expo/config";

// All server work (profile, report reading, roles) lives in JustFit_server; the app has no
// Expo API routes, so no server origin is needed here.
export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) throw new Error("Expo config must define both name and slug.");
  return { ...config, name: config.name, slug: config.slug };
};
