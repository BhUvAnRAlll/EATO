// JS copy of the design tokens in tokens.css.
// Use className first — reach for these only where className isn't supported
// (SafeAreaView, navigator options, icon colors, StatusBar). Keep both files in sync.

// The light palette (the 2026-10-31 look). Comments say what each colour is for.
export const lightColors = {
  primary: "#20BF65",
  primaryPressed: "#17A457",
  primaryText: "#087A43",
  onPrimary: "#FFFFFF",
  accentSoft: "#EAF8EF",
  // AI Coach only: the bright start of the button gradient and the page wash
  primaryBright: "#39C978",
  coachWash: "#F6F4EF",
  ink: "#111111",
  inkFill: "#111111",
  immersive: "#111111",
  violet: "#7C5CD6",

  success: "#2F8F57",
  warning: "#C4923F",
  danger: "#D92D20",
  cart: "#D92D20",
  info: "#4A6CF7",

  successSoft: "#E3F6EA",
  warningSoft: "#FBF3E6",
  dangerSoft: "#FDECEC",

  muted: "#5C5C63",
  faint: "#767680",
  line: "#E8E8EA",
  lineStrong: "#C9C9CF",
  surfaceAlt: "#F4F4F5",
  background: "#F6F4EF",
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
  tintRose: "#FDEBE7",
  tintYellow: "#FFF3D6",
  iconBlue: "#3B5BDB",
  iconGreen: "#2F8F57",
  iconPeach: "#C25400",
  iconLavender: "#7C5CD6",
  // Icons by meaning (constants/iconColors.ts, 2026-11-10)
  iconCalories: "#C25400",
  iconWater: "#3B5BDB",
  iconFavorite: "#D92D20",
  iconRating: "#C4923F",
  iconLocation: "#D92D20",
  iconTime: "#3B5BDB",
  iconDelivery: "#3B5BDB",
  iconOffer: "#C25400",
  iconInfo: "#4A6CF7",
  iconWarning: "#C4923F",
  iconSuccess: "#2F8F57",
  iconVeg: "#2F8F57",
  iconRose: "#E5482B",
  iconYellow: "#E09B00",

  leaf: "#20BF65",
  leafSoft: "#EAF8EF",
  leafDark: "#111111",

  cream: "#F6F4EF",
  creamDeep: "#F4F4F5",
  forest: "#20BF65",
  forestInk: "#111111",
  sand: "#E8E8EA",
  bronze: "#B8955F",
  creamLine: "#E8E8EA",
  creamTab: "#E9E9EC",
  creamLight: "#FFFFFF",
  inkSoft: "#3F3F46",
  forestSoft: "#EAF8EF",

  protein: "#6CC28A",
  carbs: "#A9A3F0",
  fat: "#F2C14E",

  // Gym admin portal only (app/gym/): its indigo look
  gymPrimary: "#4F46E5",
  gymPrimaryPressed: "#4338CA",
  gymPrimaryText: "#4338CA",
  gymPrimarySoft: "#EEF2FF",
  gymGradFrom: "#4F46E5",
  // Home's count tiles: ground, outline, icon square, icon
  gymTileViolet: "#F2F0FF",
  gymTileVioletLine: "#E2DDFB",
  gymTileVioletBox: "#E6E2FF",
  gymTileVioletIcon: "#4F46E5",
  gymTileOrange: "#FFF6EC",
  gymTileOrangeLine: "#FBE3C8",
  gymTileOrangeBox: "#FDEBD5",
  gymTileOrangeIcon: "#EA7A12",
  gymTileBlue: "#EEF5FF",
  gymTileBlueLine: "#D6E6FB",
  gymTileBlueBox: "#DDEBFD",
  gymTileBlueIcon: "#3B6FE0",
  gymTileGreen: "#ECFBF2",
  gymTileGreenLine: "#CDEFD9",
  gymTileGreenBox: "#D7F4E2",
  gymTileGreenIcon: "#16A34A",
  gymTilePink: "#FFF0F2",
  gymTilePinkLine: "#F8D4DA",
  gymTilePinkBox: "#FDDDE2",
  gymTilePinkIcon: "#E11D48",
  gymTilePurple: "#F4F0FF",
  gymTilePurpleLine: "#E3DAFB",
  gymTilePurpleBox: "#E9E1FF",
  gymTilePurpleIcon: "#7C3AED",
  gymGradTo: "#7C3AED",
  gymPrimaryLine: "#B4BCF5",
  gymPage: "#FFFFFF",
  gymCanvas: "#F5F6FA",
  gymHairline: "#ECEEF3",
  gymBar: "#F8FAFC",
  gymLine: "#E5E7EB",
  gymInk: "#111827",
  gymInkSoft: "#374151",
  gymMuted: "#4B5563",
  gymFaint: "#9CA3AF",
  gymSuccess: "#059669",
  gymSuccessSoft: "#ECFDF5",
  gymSuccessLine: "#A7F3D0",
  gymWarning: "#D97706",
  gymWarningSoft: "#FFFBEB",
  gymDanger: "#DC2626",
  gymDangerSoft: "#FEF2F2",
  gymNavy: "#1B2140",
  gymNavySoft: "#2C3454",
  gymNavyLine: "#6B7394",
  gymNavyMuted: "#C3C8DC",
  gymWarningLine: "#F2C94C",
  gymWarningInk: "#7A4B00",
  // The gym invoice template's red (app/gym/invoice.tsx, same as the PDF in lib/gymInvoice.ts)
  gymInvoiceRed: "#D40005",
  gymInvoiceRedSoft: "#FDEAEA",

  // Meals module only (Meals tab, a meal, the cart, orders): its green look
  mealPrimary: "#20BF65",
  mealDark: "#087A43",
  mealSecondary: "#39C978",
  mealLight: "#EAF8EF",
  mealSurface: "#F3FBF5",
  mealLine: "#E6EEE8",
  mealNonveg: "#9A4A1C",

  white: "#FFFFFF",
  black: "#000000",
};

export type Palette = { [K in keyof typeof lightColors]: string };

// The Fitness tab's program cards: one gradient (top-left to bottom-right) per palette name the
// server stores (fitness_programs.palette). White text and icons sit on every one. Kept in sync
// with the --color-program-* tokens in tokens.css.
export const programGradients: Record<string, [string, string]> = {
  lavender: ["#8B7CF6", "#5B47D6"],
  coral: ["#FF8A65", "#E0435B"],
  mint: ["#34C796", "#178A6A"],
  sky: ["#5AACF8", "#2F6FD8"],
  amber: ["#F7B955", "#E07B1E"],
  rose: ["#F27AA6", "#C2417A"],
  ink: ["#4A4A5A", "#17171F"],
  teal: ["#33BCC8", "#16808F"],
};

// justFit has one look: light (2026-11-01: dark mode and the Appearance picker were removed).
// The hooks stay so components keep one way to read colours:
//   const colors = useThemeColors();
export function useThemeColors(): Palette {
  return lightColors;
}

// `colors` outside a component (helpers, module constants)
export const colors: Palette = lightColors;

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
