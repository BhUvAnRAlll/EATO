import * as ImagePicker from "expo-image-picker";

// Photos for posts: picked from the camera or the library, read as base64 for the upload
// and kept with their local uri for the preview. The server checks the real bytes again.

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";

export type PickedPhoto = { uri: string; data: string; mediaType: PhotoType };

// Same limit the server enforces; checked here too so the member gets a quick answer
export const MAX_PHOTO_BYTES = 7 * 1024 * 1024;

type PickPhotosResult = { ok: true; photos: PickedPhoto[] } | { ok: false; error: string } | { ok: false; cancelled: true };

// The real type from the first bytes (base64 of the file's "magic numbers"), never the
// file's name: on the web the library hands back the file as it is, so a PNG stays a PNG
function typeOf(base64: string): PhotoType | null {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  return null;
}

// Opens the camera (one photo) or the library (up to `limit` photos, in the order chosen)
export async function pickPhotos(source: "camera" | "library", limit: number): Promise<PickPhotosResult> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, error: "Allow camera access in Settings to take a photo." };
  }
  // quality < 1 re-encodes to JPEG on a phone, so HEIC photos arrive in a supported format
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 0.85,
    base64: true,
    allowsMultipleSelection: source === "library" && limit > 1,
    selectionLimit: limit,
    orderedSelection: true,
  };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return { ok: false, cancelled: true };

  const photos: PickedPhoto[] = [];
  for (const asset of result.assets.slice(0, limit)) {
    if (!asset.base64) return { ok: false, error: "That photo couldn't be read. Please try another." };
    if (asset.base64.length * 0.75 > MAX_PHOTO_BYTES) return { ok: false, error: "Each photo can be up to 7 MB." };
    const mediaType = typeOf(asset.base64);
    if (!mediaType) return { ok: false, error: "Choose a JPEG, PNG or WebP photo." };
    photos.push({ uri: asset.uri, data: asset.base64, mediaType });
  }
  return { ok: true, photos };
}
