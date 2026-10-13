// JS copy of the design tokens in tokens.css.
// Use className first — reach for these only where className isn't supported
// (SafeAreaView, navigator options, icon colors, StatusBar). Keep both files in sync.

export const colors = {
  primary: "#B7FF00",
  accentSoft: "#ECFFC2",
  ink: "#0B0B0F",
  violet: "#7C6CF0",

  success: "#3FC66B",
  warning: "#F5A524",
  danger: "#F0553D",
  info: "#5B9CF8",

  successSoft: "#E2F6E8",
  warningSoft: "#FDF0D6",
  dangerSoft: "#FDE4DF",

  muted: "#71727A",
  faint: "#9A9BA4",
  line: "#E6E6EB",
  surfaceAlt: "#F1F1F4",
  background: "#F5F5F7",
  surface: "#FFFFFF",
  infoSoft: "#EEEDFB",

  leaf: "#3A6B27",
  leafSoft: "#E2EEDA",
  leafDark: "#173E1F",

  cream: "#FDFAF4",
  creamDeep: "#F6EEE2",
  forest: "#1A322A",
  forestInk: "#0C1D19",
  sand: "#D6CFC4",
  bronze: "#B2906B",
  creamLine: "#E6E2DA",
  creamTab: "#EDEBE7",
  creamLight: "#FFFDF9",
  inkSoft: "#4B4C4D",
  forestSoft: "#E9F0EA",

  protein: "#F0553D",
  carbs: "#F5A524",
  fat: "#5B9CF8",

  white: "#FFFFFF",
  black: "#000000",
} as const;

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
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 9999,
} as const;

export const controlHeight = {
  sm: 40,
  md: 46,
  lg: 52,
} as const;
