import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import type { BodyCompositionReport } from "@/lib/nutrition";

export type ReportSource = "camera" | "library" | "pdf";

export type PickedReport = { data: string; mediaType: "image/jpeg" | "application/pdf" };

// Same limits the server enforces; checked here too so users get a quick answer
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

type PickResult = { ok: true; file: PickedReport } | { ok: false; error: string } | { ok: false; cancelled: true };

// Opens the camera, the photo library or the document picker
export async function pickReport(source: ReportSource): Promise<PickResult> {
  if (source === "pdf") {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (result.canceled) return { ok: false, cancelled: true };
    const file = new File(result.assets[0].uri);
    if ((file.size ?? 0) > MAX_PDF_BYTES) return { ok: false, error: "That PDF is too large (max 10 MB)." };
    return { ok: true, file: { data: await file.base64(), mediaType: "application/pdf" } };
  }

  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, error: "Allow camera access in Settings to take a photo of your report." };
  }

  // quality < 1 re-encodes to JPEG, so iPhone HEIC photos arrive in a supported format
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.85, base64: true };
  const result =
    source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return { ok: false, cancelled: true };

  const base64 = result.assets[0].base64;
  if (!base64) return { ok: false, error: "That photo couldn't be read. Please try another." };
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) return { ok: false, error: "That photo is too large (max 7 MB)." };
  return { ok: true, file: { data: base64, mediaType: "image/jpeg" } };
}

// Sends the file to our server, which reads it and returns UNCONFIRMED values.
// `token` is the Clerk session token (proves who is uploading).
export async function readReport(
  file: PickedReport,
  token: string | null,
): Promise<{ ok: true; report: BodyCompositionReport } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Please sign in again." };
  try {
    const response = await fetch("/api/body-composition", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(file),
    });
    const body = (await response.json()) as { report?: BodyCompositionReport; error?: string };
    if (!response.ok || !body.report) return { ok: false, error: body.error ?? "We couldn't read your report." };
    return { ok: true, report: body.report };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
