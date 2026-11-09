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

// The app's own files get src/lib/reactNative.js instead, which caps how far Text and TextInput
// grow with the phone's text size (1.3×); that file itself, and every library, get the real one.
const appFolder = `${path.join(__dirname, "src")}${path.sep}`;
const capFile = path.join(__dirname, "src", "lib", "reactNative.js");
// The same for "react-native-safe-area-context": src/lib/safeArea.js pads SafeAreaView with the
// insets in the app's proportional scale (lib/reactNative.js)
const safeAreaFile = path.join(__dirname, "src", "lib", "safeArea.js");
const shims = [capFile, safeAreaFile];

nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native" && context.originModulePath.startsWith(appFolder) && context.originModulePath !== capFile) {
    return { type: "sourceFile", filePath: capFile };
  }
  if (moduleName === "react-native-safe-area-context" && context.originModulePath.startsWith(appFolder) && !shims.includes(context.originModulePath)) {
    return { type: "sourceFile", filePath: safeAreaFile };
  }
  if (moduleName === "react-native" && context.originModulePath.includes(expoAssetFolder)) {
    const resolveRequest = config.resolver?.resolveRequest ?? context.resolveRequest;
    return resolveRequest(context, moduleName, platform);
  }
  return nativewindResolveRequest(context, moduleName, platform);
};

module.exports = nativewindConfig;
