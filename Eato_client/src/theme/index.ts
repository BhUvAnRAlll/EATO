// JS copy of the design tokens in tokens.css.
// Use className first — reach for these only where className isn't supported
// (SafeAreaView, navigator options, icon colors, StatusBar). Keep both files in sync.

export const colors = {
  primary: "#C5D3EA",
  accentSoft: "#E2EBF6",
  ink: "#141515",
  violet: "#A795E2",

  success: "#10213A",
  warning: "#C49A5A",
  danger: "#F3435A",
  info: "#97BEF3",

  successSoft: "#E2EBF6",
  warningSoft: "#F6EFE5",
  dangerSoft: "#FDE5E8",

  muted: "#676A72",
  faint: "#8F9197",
  line: "#EEEAE6",
  surfaceAlt: "#F6F2EF",
  background: "#F9F7F5",
  surface: "#FFFFFF",
  infoSoft: "#E2EBF6",

  leaf: "#10213A",
  leafSoft: "#E2EBF6",
  leafDark: "#141515",

  cream: "#F9F7F5",
  creamDeep: "#F6F2EF",
  forest: "#141515",
  forestInk: "#141515",
  sand: "#EDE7E3",
  bronze: "#B49469",
  creamLine: "#EEEAE6",
  creamTab: "#E9E6E2",
  creamLight: "#FFFFFF",
  inkSoft: "#4B4C4D",
  forestSoft: "#E2EBF6",

  protein: "#8E7BD6",
  carbs: "#B49469",
  fat: "#6FA3EA",

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
