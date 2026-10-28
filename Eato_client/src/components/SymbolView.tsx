import { SymbolView as ExpoSymbolView, type SymbolViewProps } from "expo-symbols";

import { materialSymbols } from "@/constants/symbols";

// expo-symbols only draws a plain SF Symbol name on iOS; on Android and the
// web it needs { android, web } names too. This wrapper adds them from the
// map, so screens keep writing name="envelope" and get an icon everywhere.
export function SymbolView({ name, ...props }: SymbolViewProps) {
  if (typeof name !== "string") return <ExpoSymbolView name={name} {...props} />;

  const material = materialSymbols[name];
  if (__DEV__ && !material) console.warn(`No Material Symbols name for "${name}" in constants/symbols.ts`);
  return <ExpoSymbolView name={{ ios: name, android: material, web: material }} {...props} />;
}

export type { SymbolViewProps };
