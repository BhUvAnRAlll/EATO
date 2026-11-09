import { Fragment, type ComponentType, type ReactNode } from "react";
import * as ReactNativeApp from "react-native";

// The root layout's wrapper: lays the app out at the design width and shrinks it evenly on a
// narrower phone (see constants/uiScale.ts). It lives in lib/reactNative.js, the app's
// "react-native", so it shares one scale with Modal, useWindowDimensions and Keyboard there.
// Without that file in the bundle (a dev server started before metro.config.js sent the app's
// "react-native" there) the app simply runs unscaled instead of failing to start: an iPhone stuck
// on the splash screen that way, 2026-11-08.
const fromShim = (ReactNativeApp as unknown as { UiScaleRoot?: ComponentType<{ children: ReactNode }> }).UiScaleRoot;
export const UiScaleRoot: ComponentType<{ children: ReactNode }> = fromShim ?? Fragment;
