import { Appearance, useColorScheme } from "react-native";

// JS copy of the design tokens in tokens.css.
// Use className first — reach for these only where className isn't supported
// (SafeAreaView, navigator options, icon colors, StatusBar). Keep both files in sync.

// The light palette (the 2026-10-31 look). Comments say what each colour is for.
export const lightColors = {
  primary: "#D40005",
  primaryPressed: "#B00004",
  primaryText: "#C00005",
  onPrimary: "#FFFFFF",
  accentSoft: "#FDEAEA",
  // AI Coach only: the bright start of the button gradient and the page wash
  primaryBright: "#F0262B",
  coachWash: "#F4F4F5",
  ink: "#111111",
  inkFill: "#111111",
  immersive: "#111111",
  violet: "#7C5CD6",

  success: "#2F8F57",
  warning: "#C4923F",
  danger: "#D92D20",
  info: "#4A6CF7",

  successSoft: "#E3F6EA",
  warningSoft: "#FBF3E6",
  dangerSoft: "#FDECEC",

  muted: "#5C5C63",
  faint: "#767680",
  line: "#E8E8EA",
  lineStrong: "#C9C9CF",
  surfaceAlt: "#F4F4F5",
  background: "#F4F4F5",
  surface: "#FFFFFF",
  infoSoft: "#E6EEFD",

  inverse: "#1C1C1E",
  onInverse: "#FFFFFF",
  onInverseMuted: "#A1A1AA",

  accentBlue: "#4A6CF7",

  tintBlue: "#E6EEFD",
  tintGreen: "#E3F6EA",
  tintPeach: "#FFEEDF",
  tintLavender: "#EEE9FB",
  iconBlue: "#3B5BDB",
  iconGreen: "#2F8F57",
  iconPeach: "#C25400",
  iconLavender: "#7C5CD6",

  leaf: "#D40005",
  leafSoft: "#FDEAEA",
  leafDark: "#111111",

  cream: "#F4F4F5",
  creamDeep: "#F4F4F5",
  forest: "#D40005",
  forestInk: "#111111",
  sand: "#E8E8EA",
  bronze: "#B8955F",
  creamLine: "#E8E8EA",
  creamTab: "#E9E9EC",
  creamLight: "#FFFFFF",
  inkSoft: "#3F3F46",
  forestSoft: "#FDEAEA",

  protein: "#6CC28A",
  carbs: "#A9A3F0",
  fat: "#F2C14E",

  white: "#FFFFFF",
  black: "#000000",
};

// The dark palette (2026-11-01): a near-black page (not pure black, which smears on OLED and
// tires the eye), cards one step lighter, light ink, and the same justFit red for buttons.
// Red as small text or a thin ring is brightened (primary-text, leaf) so it stays readable on
// dark. Soft fills become deep tints. White and black never change (text on red, QR codes).
// tokens.css carries the same values for className styles; keep the three lists in sync.
export const darkColors: Palette = {
  primary: "#D40005",
  primaryPressed: "#B00004",
  primaryText: "#FF6B6B",
  onPrimary: "#FFFFFF",
  accentSoft: "#3B1517",
  primaryBright: "#F0262B",
  coachWash: "#0F0F11",
  ink: "#F2F2F7",
  inkFill: "#3A3A40",
  immersive: "#0B0B0D",
  violet: "#B39DFF",
  success: "#3DCB7F",
  warning: "#E5B864",
  danger: "#FF5A4F",
  info: "#8EA6FF",
  successSoft: "#11301F",
  warningSoft: "#352A17",
  dangerSoft: "#3B1517",
  muted: "#AEAEB5",
  faint: "#8E8E96",
  line: "#2E2E33",
  lineStrong: "#4A4A51",
  surfaceAlt: "#26262B",
  background: "#0F0F11",
  surface: "#1C1C1F",
  infoSoft: "#18233F",
  inverse: "#2A2A2F",
  onInverse: "#FFFFFF",
  onInverseMuted: "#A1A1AA",
  accentBlue: "#8EA6FF",
  tintBlue: "#18233F",
  tintGreen: "#11301F",
  tintPeach: "#3A2516",
  tintLavender: "#271F40",
  iconBlue: "#8EA6FF",
  iconGreen: "#4CD38A",
  iconPeach: "#FF9F5A",
  iconLavender: "#B39DFF",
  leaf: "#FF4D4F",
  leafSoft: "#3B1517",
  leafDark: "#F2F2F7",
  cream: "#0F0F11",
  creamDeep: "#26262B",
  forest: "#D40005",
  forestInk: "#F2F2F7",
  sand: "#2E2E33",
  bronze: "#C9A36C",
  creamLine: "#2E2E33",
  creamTab: "#2C2C31",
  creamLight: "#1C1C1F",
  inkSoft: "#D1D1D6",
  forestSoft: "#3B1517",
  protein: "#6CC28A",
  carbs: "#A9A3F0",
  fat: "#F2C14E",
  white: "#FFFFFF",
  black: "#000000",
};

export type Palette = { [K in keyof typeof lightColors]: string };
export type Scheme = "light" | "dark";

// The palette for the phone's appearance. Components read colours through this hook, so a
// switch between light and dark re-renders them with the right icon, ring and chart colours:
//   const colors = useThemeColors();
export function useThemeColors(): Palette {
  return useColorScheme() === "dark" ? darkColors : lightColors;
}

export function useScheme(): Scheme {
  return useColorScheme() === "dark" ? "dark" : "light";
}

// `colors` outside a component (helpers, module constants): always the palette for the
// appearance right now. Inside a component use useThemeColors() so it re-renders on a switch.
let current: Scheme = Appearance.getColorScheme() === "dark" ? "dark" : "light";
Appearance.addChangeListener(({ colorScheme }) => {
  current = colorScheme === "dark" ? "dark" : "light";
});
export const colors = {} as Palette;
for (const key of Object.keys(lightColors) as (keyof Palette)[]) {
  Object.defineProperty(colors, key, { enumerable: true, get: () => (current === "dark" ? darkColors : lightColors)[key] });
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 9999,
} as const;

export const controlHeight = {
  sm: 44,
  md: 48,
  lg: 54,
} as const;

// Every Switch uses these, so toggles look the same everywhere: red when on, soft grey
// when off, white thumb (activeThumbColor is the web's on-thumb, teal by default otherwise)
export function useSwitchColors() {
  const colors = useThemeColors();
  return {
    trackColor: { false: colors.creamTab, true: colors.leaf },
    thumbColor: colors.white,
    activeThumbColor: colors.white,
    ios_backgroundColor: colors.creamTab,
  };
}
