// JS copy of the design tokens in tokens.css.
// Use className first — reach for these only where className isn't supported
// (SafeAreaView, navigator options, icon colors, StatusBar). Keep both files in sync.

export const colors = {
  primary: "#C8C4F5",
  accentSoft: "#F0EFF8",
  ink: "#15151D",
  violet: "#A9A3F0",

  success: "#5E56C9",
  warning: "#C4923F",
  danger: "#E5484D",
  info: "#8FB4EE",

  successSoft: "#F0EFF8",
  warningSoft: "#FBF3E6",
  dangerSoft: "#FDECEC",

  muted: "#6E7079",
  faint: "#A0A2AA",
  line: "#E8E9ED",
  surfaceAlt: "#F5F6F7",
  background: "#FFFFFF",
  surface: "#FFFFFF",
  infoSoft: "#EEF3FC",

  leaf: "#5E56C9",
  leafSoft: "#F0EFF8",
  leafDark: "#15151D",

  cream: "#FFFFFF",
  creamDeep: "#F5F6F7",
  forest: "#101018",
  forestInk: "#15151D",
  sand: "#E8E9ED",
  bronze: "#B8955F",
  creamLine: "#E8E9ED",
  creamTab: "#ECEEF2",
  creamLight: "#FFFFFF",
  inkSoft: "#45464F",
  forestSoft: "#F0EFF8",

  protein: "#6CC28A",
  carbs: "#A9A3F0",
  fat: "#F2C14E",

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
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 9999,
} as const;

export const controlHeight = {
  sm: 44,
  md: 48,
  lg: 54,
} as const;

// Every Switch uses these, so toggles look the same everywhere: lavender when on, soft grey
// when off, white thumb (activeThumbColor is the web's on-thumb, teal by default otherwise)
export const switchColors = {
  trackColor: { false: colors.creamTab, true: colors.leaf },
  thumbColor: colors.white,
  activeThumbColor: colors.white,
  ios_backgroundColor: colors.creamTab,
};
