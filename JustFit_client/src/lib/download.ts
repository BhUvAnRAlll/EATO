import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { getApiUrl, reportRefusal } from "@/lib/api";
import { TIMED_OUT, timeoutFor } from "@/lib/apiRules";

// Downloads an authenticated CSV file from the justFit server (the token goes in the header, never
// in the address). On the web the browser saves it; on a phone it is written to the app's cache
// and handed to the share sheet (Save to Files, Drive, email…), as the attendance export does: the
// cache alone is out of the user's reach. A stalled download gives up instead of spinning for ever.
// Resolves with the file's name, or a friendly error line.
export type DownloadResult = { ok: true; where: string } | { ok: false; error: string };

export async function downloadFile(path: string, token: string | null): Promise<DownloadResult> {
  const route = path.split("?")[0];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(route));
  let csv: string;
  let name: string;
  try {
    const response = await fetch(`${getApiUrl()}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal });
    if (!response.ok) {
      reportRefusal(response.status, token, route);
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: data?.error ?? "Couldn't make that file." };
    }
    name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "justfit-export.csv";
    csv = await response.text();
  } catch {
    if (controller.signal.aborted) return { ok: false, error: TIMED_OUT };
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }

  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, where: name };
  }

  try {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(csv);
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: "Sharing isn't available on this phone." };
    await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "Export CSV" });
    return { ok: true, where: name };
  } catch {
    return { ok: false, error: "Couldn't save the file on this phone. Please try again." };
  }
}
