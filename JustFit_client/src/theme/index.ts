// JS copy of the design tokens in tokens.css.
// Use className first — reach for these only where className isn't supported
// (SafeAreaView, navigator options, icon colors, StatusBar). Keep both files in sync.

export const colors = {
  primary: "#D40005",
  primaryPressed: "#B00004",
  primaryText: "#C00005",
  onPrimary: "#FFFFFF",
  accentSoft: "#FDEAEA",
  // AI Coach only: the bright start of the button gradient and the page wash
  primaryBright: "#F0262B",
  coachWash: "#F4F4F5",
  ink: "#111111",
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
export const switchColors = {
  trackColor: { false: colors.creamTab, true: colors.leaf },
  thumbColor: colors.white,
  activeThumbColor: colors.white,
  ios_backgroundColor: colors.creamTab,
};
