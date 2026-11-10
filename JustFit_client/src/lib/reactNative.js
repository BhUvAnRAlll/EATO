// The app's "react-native" (metro.config.js sends every import of "react-native" from src/ here):
// the same module with four changes, so every screen gets them without importing anything new.
//
// 1. Proportional scale (constants/uiScale.ts): on a phone narrower than 430 points (the iPhone 15
//    Plus) the app lays out at 430 and is shrunk evenly to fit. UiScaleRoot (the root layout) and every Modal (a sheet
//    is its own window) draw their content scaled; useWindowDimensions reports the layout size;
//    Keyboard events report heights in layout points; useSafeAreaInsets (via ScaledInsets) too.
// 2. Text grows with the phone's text-size setting only as far as the width allows
//    (constants/textScale.ts: never over 1.3×). A screen can pass a lower maxFontSizeMultiplier.
//
// Plain JavaScript on purpose: TypeScript still reads "react-native"'s own types, and nothing here
// may read React Native's exports early (some, like InteractionManager, throw when read in React
// Native 0.88), so each one is passed through as a getter.
const React = require("react");
// React Native itself, required on first use (see the export below)
let RN = null;
const rn = () => (RN ??= require("justfit-real:react-native"));
const { maxTextScaleFor } = require("../constants/textScale");
const { uiScaleFor } = require("../constants/uiScale");

const h = React.createElement;

// The real window size and the scale for it
function useScale() {
  const real = rn().useWindowDimensions();
  return { real, scale: uiScaleFor(real.width) };
}

// The window as the app lays it out (430 wide on a narrower phone)
function useWindowDimensions() {
  const { real, scale } = useScale();
  return scale === 1 ? real : { ...real, width: real.width / scale, height: real.height / scale, scale: real.scale * scale };
}

// Safe-area insets in layout points inside a scaled view (the real insets would shrink with it)
let SafeArea = null;
const safeArea = () => (SafeArea ??= require("justfit-real:react-native-safe-area-context"));
function ScaledInsets({ scale, children }) {
  const { SafeAreaInsetsContext, SafeAreaFrameContext, useSafeAreaInsets, useSafeAreaFrame } = safeArea();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const scaled = { top: insets.top / scale, right: insets.right / scale, bottom: insets.bottom / scale, left: insets.left / scale };
  const scaledFrame = { x: frame.x / scale, y: frame.y / scale, width: frame.width / scale, height: frame.height / scale };
  return h(SafeAreaFrameContext.Provider, { value: scaledFrame }, h(SafeAreaInsetsContext.Provider, { value: scaled }, children));
}

// Draws its children laid out at the design width and shrunk to the real screen
function Scaled({ children }) {
  const { real, scale } = useScale();
  if (scale === 1) return children;
  return h(
    rn().View,
    { style: { flex: 1, overflow: "hidden" }, collapsable: false },
    h(
      rn().View,
      { style: { width: real.width / scale, height: real.height / scale, transform: [{ scale }], transformOrigin: "top left" } },
      h(ScaledInsets, { scale }, children),
    ),
  );
}

// A Modal whose content is scaled like the rest of the app
function Modal(props) {
  return h(rn().Modal, props, h(Scaled, null, props.children));
}

// Keyboard events with the keyboard's size in layout points
const keyboardEvent = (event) => {
  const scale = uiScaleFor(rn().Dimensions.get("window").width);
  if (scale === 1 || !event?.endCoordinates) return event;
  const c = event.endCoordinates;
  return { ...event, endCoordinates: { ...c, height: c.height / scale, width: c.width / scale, screenX: c.screenX / scale, screenY: c.screenY / scale } };
};
let Keyboard = null;
const keyboard = () =>
  (Keyboard ??= Object.assign(Object.create(rn().Keyboard), {
    addListener: (name, listener, context) => rn().Keyboard.addListener(name, (event) => listener.call(context, keyboardEvent(event))),
    metrics: () => {
      const m = rn().Keyboard.metrics();
      const scale = uiScaleFor(rn().Dimensions.get("window").width);
      return m && scale !== 1 ? { ...m, height: m.height / scale, width: m.width / scale, screenX: m.screenX / scale, screenY: m.screenY / scale } : m;
    },
  }));

const capped = (Component) => {
  const Capped = (props) => {
    const { width } = useWindowDimensions();
    const limit = maxTextScaleFor(width);
    const own = props.maxFontSizeMultiplier;
    return h(Component, { ...props, maxFontSizeMultiplier: own != null && own > 0 ? Math.min(own, limit) : limit });
  };
  Capped.displayName = Component.displayName || Component.name;
  return Capped;
};

// The module is exported before anything else is required and reads React Native lazily, on
// each first use: a module that imports "react-native" while this one is still loading (an import
// cycle through the styling runtime) then still finds every export, instead of an empty object
// with Platform and Pressable undefined (found on Android after a cache clear, 2026-11-08)
let Text, TextInput;
const own = {
  get Text() { return (Text ??= capped(rn().Text)); },
  get TextInput() { return (TextInput ??= capped(rn().TextInput)); },
  get Modal() { return Modal; },
  get useWindowDimensions() { return useWindowDimensions; },
  get Keyboard() { return keyboard(); },
  // The root layout's wrapper (not a React Native export; imported from "@/lib/uiScale")
  get UiScaleRoot() { return Scaled; },
};
const OWN_KEYS = Object.keys(own);

module.exports = new Proxy({}, {
  get: (_, key) => (OWN_KEYS.includes(key) ? own[key] : rn()[key]),
  has: (_, key) => OWN_KEYS.includes(key) || key in rn(),
  ownKeys: () => [...new Set([...Object.keys(rn()), ...OWN_KEYS])],
  getOwnPropertyDescriptor: (_, key) => (OWN_KEYS.includes(key) || key in rn() ? { enumerable: true, configurable: true, get: () => (OWN_KEYS.includes(key) ? own[key] : rn()[key]) } : undefined),
});
