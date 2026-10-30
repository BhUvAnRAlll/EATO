import { Platform } from "react-native";

import { getApiUrl } from "@/lib/api";

// Downloads an authenticated file from the justFit server (the token goes in the header, never
// in the address). On the web the browser saves it; on a phone the bytes are written to the
// app's cache and the path is returned for the caller to show or share. Resolves with where the
// file went, or a friendly error line.
export type DownloadResult = { ok: true; where: string } | { ok: false; error: string };

export async function downloadFile(path: string, token: string | null): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error ?? "Couldn't make that file." };
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "justfit-export.csv";

  if (Platform.OS === "web") {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, where: name };
  }

  // On a phone: write to the app's cache folder. expo-file-system's File API (SDK 54+).
  const { File, Paths } = await import("expo-file-system");
  const file = new File(Paths.cache, name);
  file.write(await response.text());
  return { ok: true, where: file.uri };
}
