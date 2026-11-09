import { apiFetch, type ApiResult } from "@/lib/api";
import type { NotificationCategory, NotificationPage, NotificationPrefs } from "@/lib/notificationRules";

export * from "@/lib/notificationRules";

// The caller's own inbox (/api/notifications): every role has one
const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
export const notificationsApi = {
  list: (token: string | null, page = 1) => (token ? apiFetch<NotificationPage>(`/api/notifications${page > 1 ? `?page=${page}` : ""}`, { token }) : signedOut<NotificationPage>()),
  read: (token: string | null, body: { ids: number[] } | { all: true }) => (token ? apiFetch<{ unread: number }>("/api/notifications/read", { token, method: "POST", body }) : signedOut<{ unread: number }>()),
  preferences: (token: string | null) => (token ? apiFetch<NotificationPrefs>("/api/notifications/preferences", { token }) : signedOut<NotificationPrefs>()),
  savePreferences: (token: string | null, muted: NotificationCategory[]) =>
    token ? apiFetch<NotificationPrefs>("/api/notifications/preferences", { token, method: "PUT", body: { muted } }) : signedOut<NotificationPrefs>(),
};
