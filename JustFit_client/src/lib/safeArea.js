// The app's "react-native-safe-area-context" (metro.config.js sends the app's imports here): the
// same module, except that SafeAreaView pads with the insets from useSafeAreaInsets(). Inside the
// app's proportional scale (lib/reactNative.js) those are in layout points; the library's native
// SafeAreaView would pad with real points that then shrink with the scale, leaving content a
// little under the status bar on a narrow phone. Props: edges (array or object) and mode
// ("padding", the default, or "margin"), as in the library.
const React = require("react");
const { View, StyleSheet } = require("react-native");
const SafeArea = require("react-native-safe-area-context");

const ALL = ["top", "right", "bottom", "left"];
const KEY = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };

function edgesOf(edges) {
  if (!edges) return ALL;
  if (Array.isArray(edges)) return edges;
  return ALL.filter((edge) => edges[edge] && edges[edge] !== "off");
}

function SafeAreaView({ edges, mode = "padding", style, children, ...rest }) {
  const insets = SafeArea.useSafeAreaInsets();
  const flat = StyleSheet.flatten(style) || {};
  const extra = {};
  for (const edge of edgesOf(edges)) {
    const prop = `${mode}${KEY[edge]}`;
    const axis = edge === "top" || edge === "bottom" ? `${mode}Vertical` : `${mode}Horizontal`;
    const own = flat[prop] ?? flat[axis] ?? flat[mode] ?? 0;
    extra[prop] = (typeof own === "number" ? own : 0) + insets[edge];
  }
  return React.createElement(View, { ...rest, style: [style, extra] }, children);
}

const app = {};
for (const key of Object.keys(SafeArea)) {
  if (key === "SafeAreaView") continue;
  Object.defineProperty(app, key, { enumerable: true, get: () => SafeArea[key] });
}
Object.defineProperty(app, "SafeAreaView", { enumerable: true, get: () => SafeAreaView });

module.exports = app;
