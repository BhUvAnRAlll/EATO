// Poppins, the Peak Fitness typeface (SIL Open Font License, assets/fonts/Poppins-OFL.txt).
// Each weight is loaded as its own family, so text picks a weight by family name and never
// relies on fontWeight (which would fake-bold a single face on Android).
// The names match --font-sans, --font-sans-medium and --font-sans-semibold in theme/tokens.css.
export const fontFiles = {
  "Poppins-Regular": require("../../assets/fonts/Poppins-Regular.ttf"),
  "Poppins-Medium": require("../../assets/fonts/Poppins-Medium.ttf"),
  "Poppins-SemiBold": require("../../assets/fonts/Poppins-SemiBold.ttf"),
};

export const fonts = {
  regular: "Poppins-Regular",
  medium: "Poppins-Medium",
  semibold: "Poppins-SemiBold",
} as const;
