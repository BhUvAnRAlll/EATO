// Server-side checks on an uploaded report before it's sent anywhere.
// Pure (no Node or React Native imports) so it can be unit-tested.

export type UploadMediaType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export const uploadLimits = {
  // Claude accepts images up to 10 MB base64-encoded (~7.5 MB of image data)
  maxImageBytes: 7 * 1024 * 1024,
  maxPdfBytes: 10 * 1024 * 1024,
} as const;

export type UploadCheck =
  | { ok: true; mediaType: UploadMediaType; bytes: Uint8Array }
  | { ok: false; status: 400 | 413 | 415; error: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(data: string): Uint8Array | null {
  const clean = data.replace(/\s/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0 || !BASE64.test(clean)) return null;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Real file type from the first bytes ("magic numbers"), not the client's label
export function sniffMediaType(bytes: Uint8Array): UploadMediaType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  return null;
}

export function checkUpload(body: unknown): UploadCheck {
  const { data, mediaType } = (body ?? {}) as { data?: unknown; mediaType?: unknown };
  if (typeof data !== "string" || typeof mediaType !== "string") {
    return { ok: false, status: 400, error: "Send the report as { data, mediaType }." };
  }

  const bytes = decodeBase64(data);
  if (!bytes) return { ok: false, status: 400, error: "The file couldn't be read." };

  const actual = sniffMediaType(bytes);
  if (!actual) {
    return { ok: false, status: 415, error: "Upload a photo (JPEG, PNG or WebP) or a PDF of your report." };
  }
  if (actual !== mediaType) {
    return { ok: false, status: 415, error: "The file type doesn't match its contents." };
  }

  const limit = actual === "application/pdf" ? uploadLimits.maxPdfBytes : uploadLimits.maxImageBytes;
  if (bytes.length > limit) {
    return { ok: false, status: 413, error: `The file is too large (max ${Math.round(limit / 1024 / 1024)} MB).` };
  }

  return { ok: true, mediaType: actual, bytes };
}
