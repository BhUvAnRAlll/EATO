import { AppState, Platform } from "react-native";
import Constants from "expo-constants";

import { apiFetch } from "@/lib/api";
import { queueRules, type QueuedEvent } from "@/lib/analyticsRules";
import { useAuthStore } from "@/store/auth";
import { onAccountCleared } from "@/lib/accountScope";

// What members do in the app, for Super Admin › App Usage. A small queue in memory: screens and
// actions call track(), events batch up and go to POST /api/analytics/events in the background,
// for the signed-in member only (the server takes the member from the session; nothing here
// names one). Never blocks anything: a failed send keeps the queue for the next try, and nothing
// is sent while signed out. Metadata is the few plain values a screen already shows; never a
// name, number, email or position (the server refuses those keys too). One session id per app
// launch, renewed after 30 minutes in the background.
//
// The queue lives only in memory (nothing is written to the device, see AGENTS.md): events from a
// launch that ends before the next flush are lost, which is acceptable for usage counts.

export type EventName =
  | "app_opened" | "screen_viewed" | "login_completed"
  | "workout_started" | "workout_completed"
  | "meal_logged" | "food_scanned" | "water_logged" | "macro_updated"
  | "ai_chat_sent" | "coach_plan_made"
  | "community_post_created" | "community_post_liked" | "community_comment_sent" | "message_sent"
  | "story_viewed" | "story_created"
  | "attendance_checked_in" | "attendance_checked_out"
  | "weight_logged" | "body_scanned";

type Metadata = Record<string, string | number | boolean>;

const FLUSH_AFTER_MS = 15_000; // a batch goes out this long after its first event
const FLUSH_AT = 20; // or as soon as this many are waiting
const RETRY_AFTER_MS = 60_000; // after a failed send
const SESSION_GAP_MS = 30 * 60_000; // a new session after this long in the background

const platform = (Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web") as "ios" | "android" | "web";
const appVersion = Constants.expoConfig?.version ?? null;

let queue: QueuedEvent[] = [];
let sessionId = newId();
let backgroundedAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;
let pausedUntil = 0;
let lastScreen: string | null = null;

function newId(): string {
  // crypto.randomUUID exists on the web and in Hermes (RN 0.7x+); fall back to a random v4 otherwise
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Records one event. Safe to call from anywhere, any time; does nothing while signed out.
export function track(name: EventName, metadata?: Metadata, screen?: string): void {
  if (useAuthStore.getState().status !== "signedIn") return;
  queue.push({ id: newId(), name, at: Date.now(), sessionId, screen, metadata });
  if (queue.length >= FLUSH_AT) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), FLUSH_AFTER_MS);
}

// A screen came into view. The same screen twice in a row (a re-render, a tab re-tap) counts once.
export function trackScreen(screen: string): void {
  if (screen === lastScreen) return;
  lastScreen = screen;
  track("screen_viewed", undefined, screen);
}

// Sends what is waiting, in batches the server accepts. Resolves when the queue is empty or the
// server couldn't take it (then the queue keeps it and pauses for a minute).
export async function flush(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (sending || queue.length === 0 || Date.now() < pausedUntil) return;
  const token = useAuthStore.getState().token;
  if (!token) return;
  sending = true;
  try {
    while (queue.length > 0) {
      const { batch, rest } = queueRules.nextBatch(queue);
      const result = await apiFetch<{ stored: number; dropped: number }>("/api/analytics/events", { method: "POST", token, body: { events: batch, platform, appVersion } });
      if (!result.ok) {
        // 400: the batch itself is wrong (a bug): drop it rather than retry forever. 401: signed
        // out meanwhile: drop it, the member is gone. Anything else: keep it and try again later.
        if (result.status === 400 || result.status === 401) queue = rest;
        else pausedUntil = Date.now() + (result.retryAfterSeconds ? result.retryAfterSeconds * 1000 : RETRY_AFTER_MS);
        return;
      }
      queue = rest;
    }
  } finally {
    sending = false;
  }
}

// The queue and the session belong to the signed-in member: signing out or switching accounts
// clears them (registered with lib/accountScope, like the stores)
export function resetAnalytics(): void {
  queue = [];
  sessionId = newId();
  lastScreen = null;
  if (timer) { clearTimeout(timer); timer = null; }
}

// App lifecycle: a launch opens a session; coming back after a long time in the background
// starts a new one; going to the background sends what is waiting
let started = false;
export function startAnalytics(): void {
  if (started) return;
  started = true;
  track("app_opened");
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      if (backgroundedAt !== null && Date.now() - backgroundedAt > SESSION_GAP_MS) {
        sessionId = newId();
        lastScreen = null;
        track("app_opened");
      }
      backgroundedAt = null;
    } else if (state === "background") {
      backgroundedAt = Date.now();
      void flush();
    }
  });
}

onAccountCleared(resetAnalytics);

// For tests and debugging only: what is waiting right now
export const pending = () => queue.length;
