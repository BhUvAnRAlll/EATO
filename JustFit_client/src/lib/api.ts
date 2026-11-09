import Constants from "expo-constants";
import { NativeModules } from "react-native";

import { devServerHost, requireHttpsInRelease } from "@/lib/apiHost";
import { hud } from "@/lib/hud";
import { errorLine, readJson, serverProblem, TIMED_OUT, timeoutFor } from "@/lib/apiRules";

// Port the justFit server (JustFit_server) listens on in development
const SERVER_PORT = 4000;

// Where the justFit server is:
// - EXPO_PUBLIC_API_URL in .env, for a deployed server
// - otherwise the computer running the Expo dev server (Metro), so a real phone on the same
//   Wi-Fi reaches it too, whatever its address today (see lib/apiHost.ts)
export function getApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");
  if (configured) return requireHttpsInRelease(configured, __DEV__);
  const scriptUrl: unknown = NativeModules.SourceCode?.getConstants?.().scriptURL;
  const host = devServerHost(Constants.expoConfig?.hostUri, typeof scriptUrl === "string" ? scriptUrl : null);
  return `http://${host ?? "localhost"}:${SERVER_PORT}`;
}

type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  // The session token (see store/auth.ts), for routes that need to know who's asking
  token?: string | null;
};

// On failure, `status` is the HTTP status when the server answered (e.g. 401 for an invalid
// session) and absent when the request never reached it; `retryAfterSeconds` is the server's
// Retry-After on a 429 (how long its rate limit asks the app to wait)
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number; retryAfterSeconds?: number };

// Told when the server refuses a signed-in request's token (401), with that token, so the app
// can offer sign-in again from any screen (lib/session.ts registers it). Sign-in's own routes
// handle their answers themselves.
let sessionRejected: ((token: string) => void) | null = null;
export function onSessionRejected(handler: ((token: string) => void) | null): void {
  sessionRejected = handler;
}

// Told when the server refuses a signed-in request with 403: the account's role may have changed
// (a gym admin added or removed them), so the app asks who it is again (lib/session.ts registers it)
let accessDenied: (() => void) | null = null;
export function onAccessDenied(handler: (() => void) | null): void {
  accessDenied = handler;
}

// A refusal from a request made outside apiFetch (the CSV download) is reported the same way, so a
// 401 offers sign-in and a 403 re-checks the account there too (QA 2026-11-07)
export function reportRefusal(status: number, token: string | null | undefined, path: string): void {
  if (status === 401 && token && !path.startsWith("/api/auth/")) sessionRejected?.(token);
  if (status === 403 && token) accessDenied?.();
}

// Calls the justFit server. JSON in, JSON out, one friendly error line on failure.
// Told after every request that changes something on the server (whatever its outcome), so a
// short-lived read cache (lib/macro's day) never outlives a change made from any screen
const writeListeners = new Set<() => void>();
export function onServerWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  const writes = (options.method ?? "GET") !== "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  // A request that hangs (a stalled server or network) gives up instead of spinning forever
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(path));
  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const body = readJson(await response.text());
    if (!response.ok) {
      reportRefusal(response.status, options.token, path);
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        ok: false,
        // A proxy's HTML error page (a 502 while the server restarts) is still the server answering
        error: errorLine(body) ?? (body.json ? "Something went wrong. Please try again." : serverProblem(response.status)),
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.ceil(retryAfter) } : {}),
      };
    }
    if (!body.json) return { ok: false, error: serverProblem(response.status), status: response.status };
    return { ok: true, data: body.value as T };
  } catch {
    if (controller.signal.aborted) return { ok: false, error: TIMED_OUT };
    // A save that never left the phone: say so at once, wherever its own error line is. Reads
    // stay quiet, as every screen shows its own "couldn't load" state with Try again
    if ((options.method ?? "GET") !== "GET") hud.offline();
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
    if (writes) writeListeners.forEach((listener) => listener());
  }
}
