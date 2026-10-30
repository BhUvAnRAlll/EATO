const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const nativewindConfig = withNativewind(config);

// NativeWind swaps every "react-native" import for its own copy, and that copy has no
// AssetRegistry. expo-asset needs the real one to load bundled files such as the icon
// font on Android, so its imports skip the swap.
const expoAssetFolder = `${path.sep}node_modules${path.sep}expo-asset${path.sep}`;
const nativewindResolveRequest = nativewindConfig.resolver.resolveRequest;

nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native" && context.originModulePath.includes(expoAssetFolder)) {
    const resolveRequest = config.resolver?.resolveRequest ?? context.resolveRequest;
    return resolveRequest(context, moduleName, platform);
  }
  return nativewindResolveRequest(context, moduleName, platform);
};

module.exports = nativewindConfig;
