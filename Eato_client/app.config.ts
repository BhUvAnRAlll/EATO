import { type ConfigContext, type ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) throw new Error("Expo config must define both name and slug.");

  const origin = process.env.EXPO_PUBLIC_API_ORIGIN?.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production" && !origin) {
    throw new Error("Set EXPO_PUBLIC_API_ORIGIN to the deployed Expo Router server URL before a production build.");
  }

  const plugins = (config.plugins ?? []).filter((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-router",
  );
  const routerPlugin: NonNullable<ExpoConfig["plugins"]>[number] = origin
    ? ["expo-router", { origin }]
    : "expo-router";

  return { ...config, name: config.name, slug: config.slug, plugins: [routerPlugin, ...plugins] };
};