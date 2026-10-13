import Constants from "expo-constants";

// Port the EATO server (EATO-SERVER) listens on in development
const SERVER_PORT = 4000;

// Where the EATO server is:
// - EXPO_PUBLIC_API_URL in .env, for a deployed server
// - otherwise the computer running the Expo dev server, so a real phone on the
//   same Wi-Fi reaches it too (not just the simulator)
export function getApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host ?? "localhost"}:${SERVER_PORT}`;
}

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // Clerk session token, for routes that need to know who's asking
  token?: string | null;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Calls the EATO server. JSON in, JSON out, one friendly error line on failure.
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) return { ok: false, error: data.error ?? "Something went wrong. Please try again." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
