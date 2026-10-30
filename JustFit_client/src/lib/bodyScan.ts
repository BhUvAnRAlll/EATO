import * as ImagePicker from "expo-image-picker";

import { apiFetch } from "@/lib/api";
import { isCompleteEstimate, photoTooLarge, type BodyScanEstimate, type ScanInputs } from "@/lib/bodyScanRules";

export type ScanView = "front" | "side";
export type PhotoSource = "camera" | "library";

// One picked photo: what the server gets (base64 JPEG) and what the screen shows
export type ScanPhoto = { data: string; previewUri: string };

type PickResult = { ok: true; photo: ScanPhoto } | { ok: false; error: string } | { ok: false; cancelled: true };

// Opens the camera or the photo library for one view. Same picker set-up as the report
// upload: quality < 1 re-encodes to JPEG, so iPhone HEIC photos arrive in a supported format.
export async function pickScanPhoto(source: PhotoSource): Promise<PickResult> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, error: "Allow camera access in Settings to take your photos." };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6, base64: true };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return { ok: false, cancelled: true };

  const asset = result.assets[0];
  if (!asset.base64) return { ok: false, error: "That photo couldn't be read. Please try another." };
  if (photoTooLarge(asset.base64)) return { ok: false, error: "That photo is too large (max 5 MB). Try again at a lower size." };
  return { ok: true, photo: { data: asset.base64, previewUri: asset.uri } };
}

// Sends both photos and the inputs to the justFit server (POST /api/body-composition/scan),
// which forwards them to the Forma model and answers with an estimate. The photos are never
// stored. `token` is the session token (lib/session.ts) (proves who is asking).
export async function requestBodyScan(
  photos: Record<ScanView, ScanPhoto>,
  inputs: ScanInputs,
  token: string | null,
): Promise<{ ok: true; estimate: BodyScanEstimate } | { ok: false; error: string; status?: number }> {
  if (!token) return { ok: false, error: "Please sign in again." };
  const result = await apiFetch<{ estimate?: BodyScanEstimate }>("/api/body-composition/scan", {
    method: "POST",
    body: { front: photos.front.data, side: photos.side.data, ...inputs },
    token,
  });
  if (!result.ok) return result;
  // An answer without the full report (an out-of-date server) can't be shown: say so plainly
  if (!isCompleteEstimate(result.data.estimate)) return { ok: false, error: "We couldn't load your report. Please try again in a moment." };
  return { ok: true, estimate: result.data.estimate };
}
