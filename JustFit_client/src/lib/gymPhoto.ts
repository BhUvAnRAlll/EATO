import * as ImagePicker from "expo-image-picker";

import { photoTypeOf } from "@/lib/adminPrograms";

// A picked image, ready to upload (the server checks the type and size again from the bytes) and
// to show before it's saved: a member's photo from Add New Member (PUT /api/gym/members/:id/photo)
// or a catalogue item's picture from Add Plan (PUT /api/gym/catalog/:id/image), or the plan payment's
// bill from Add Member (PUT /api/gym/payments/:id/receipt)
export type MemberPhoto = { data: string; mediaType: string; previewUri: string };
export type PhotoSource = "camera" | "library";

export const MEMBER_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
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

/** The plan payment's bill from Add Member (PUT /api/gym/payments/:id/receipt): any shape, a till slip is tall */
export const pickReceiptImage = (source: PhotoSource) => pickImage(source, { square: false, what: "the bill" });

async function pickImage(source: PhotoSource, { square, what }: { square: boolean; what: string }): Promise<Picked> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, error: `Allow camera access in Settings to take ${what}.` };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: square, ...(square ? { aspect: [1, 1] as [number, number] } : {}), quality: 0.5, base64: true, exif: false };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return { ok: false, cancelled: true };
  const asset = result.assets[0];
  // The web picker may give a data: URL instead of base64
  const dataUrl = /^data:([^;]+);base64,(.+)$/.exec(asset.uri ?? "");
  const data = asset.base64 ?? dataUrl?.[2] ?? null;
  if (!data) return { ok: false, error: "That photo couldn't be read. Please try another." };
  const mediaType = photoTypeOf(data);
  if (!mediaType || !PHOTO_TYPES.includes(mediaType)) return { ok: false, error: "Choose a JPEG, PNG or WebP photo." };
  if (base64Bytes(data) > MEMBER_PHOTO_MAX_BYTES) return { ok: false, error: "That photo is too large (max 3 MB). Try another." };
  return { ok: true, photo: { data, mediaType, previewUri: asset.uri } };
}
