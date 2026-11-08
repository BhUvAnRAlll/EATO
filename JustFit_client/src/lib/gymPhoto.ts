import * as ImagePicker from "expo-image-picker";

import { photoTypeOf } from "@/lib/adminPrograms";
import { hasNativeModule } from "@/lib/nativeModules";

// A picked image, ready to upload (the server checks the type and size again from the bytes) and
// to show before it's saved: a member's photo from Add New Member (PUT /api/gym/members/:id/photo)
// or a catalogue item's picture from Add Plan (PUT /api/gym/catalog/:id/image), or the plan payment's
// bill from Add Member (PUT /api/gym/payments/:id/receipt)
export type MemberPhoto = { data: string; mediaType: string; previewUri: string };
export type PhotoSource = "camera" | "library";

export const MEMBER_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
// Photos are shrunk on the phone before upload (2026-11-07): a member's square photo to 512 px
// (the list shows it at 44 px), a brochure or bill to 1600 px on its long side (still readable)
export const MEMBER_PHOTO_SIDE = 512;
export const IMAGE_LONG_SIDE = 1600;
// The gym's logo prints small (about 4 cm wide on an A4 invoice), so 512 px on its long side is plenty
export const LOGO_LONG_SIDE = 512;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
type Picked = { ok: true; photo: MemberPhoto } | { ok: false; error: string } | { ok: false; cancelled: true };

// Bytes in a base64 string (without decoding it)
const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

/**
 * Takes a photo with the camera or chooses one from the library, cropped square. quality < 1
 * re-encodes to JPEG on the phone (so HEIC works, and the photo's location data is left out). On
 * the web the chosen file is sent as it is.
 */
export const pickMemberPhoto = (source: PhotoSource) => pickImage(source, { square: true, what: "the member's photo" });

/** A catalogue item's picture or brochure photo: any shape, so a brochure page isn't cut */
export const pickCatalogImage = (source: PhotoSource) => pickImage(source, { square: false, what: "the photo" });

/** The gym's logo for its invoices (PUT /api/gym/logo): any shape, a wordmark is wide, a mark is square */
export const pickLogoImage = (source: PhotoSource) => pickImage(source, { square: false, what: "the logo", side: LOGO_LONG_SIDE });

/** A bill: the plan payment's from Add Member (PUT /api/gym/payments/:id/receipt) or an expense's
 * (PUT /api/gym/expenses/:id/bill); any shape, a till slip is tall */
export const pickReceiptImage = (source: PhotoSource) => pickImage(source, { square: false, what: "the bill" });

async function pickImage(source: PhotoSource, { square, what, side }: { square: boolean; what: string; side?: number }): Promise<Picked> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, error: `Allow camera access in Settings to take ${what}.` };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: square, ...(square ? { aspect: [1, 1] as [number, number] } : {}), quality: 0.5, base64: true, exif: false };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return { ok: false, cancelled: true };
  const asset = result.assets[0];
  const small = await shrink(asset, side ?? (square ? MEMBER_PHOTO_SIDE : IMAGE_LONG_SIDE));
  // The web picker may give a data: URL instead of base64
  const dataUrl = /^data:([^;]+);base64,(.+)$/.exec(asset.uri ?? "");
  const data = small?.data ?? asset.base64 ?? dataUrl?.[2] ?? null;
  if (!data) return { ok: false, error: "That photo couldn't be read. Please try another." };
  const mediaType = photoTypeOf(data);
  if (!mediaType || !PHOTO_TYPES.includes(mediaType)) return { ok: false, error: "Choose a JPEG, PNG or WebP photo." };
  if (base64Bytes(data) > MEMBER_PHOTO_MAX_BYTES) return { ok: false, error: "That photo is too large (max 3 MB). Try another." };
  return { ok: true, photo: { data, mediaType, previewUri: small?.uri ?? asset.uri } };
}

// The picked image no larger than `side` on its longer edge, as a JPEG with its base64; null when
// it's already small enough or when shrinking fails (the original is used then, checked as before).
// expo-image-manipulator is loaded here only, and only when this build has it (lib/nativeModules.ts):
// an app built before it was added sends the photo unshrunk instead of crashing every photo sheet.
async function shrink(asset: ImagePicker.ImagePickerAsset, side: number): Promise<{ data: string; uri: string } | null> {
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
