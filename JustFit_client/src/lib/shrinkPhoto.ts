import type * as ImagePicker from "expo-image-picker";

import { hasNativeModule } from "@/lib/nativeModules";

// The picked image no larger than `side` on its longer edge, as a JPEG with its base64; null when
// it's already small enough or when shrinking fails (the caller uses the original then).
// expo-image-manipulator is loaded here only, and only when this build has it (lib/nativeModules.ts):
// an app built before it was added sends the photo unshrunk instead of crashing every photo sheet.
export async function shrinkPhoto(asset: ImagePicker.ImagePickerAsset, side: number): Promise<{ data: string; uri: string } | null> {
  const { width, height, uri } = asset;
  if (!uri || !width || !height || Math.max(width, height) <= side) return null;
  if (!hasNativeModule("ExpoImageManipulator")) return null;
  try {
    const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
    const context = ImageManipulator.manipulate(uri);
    context.resize(width >= height ? { width: side, height: null } : { width: null, height: side });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
    return saved.base64 ? { data: saved.base64, uri: saved.uri } : null;
  } catch {
    return null;
  }
}
