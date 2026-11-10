import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import { onAccountCleared } from "@/lib/accountScope";
import { mealsApi } from "@/lib/mealsApi";
import { ORDER_REMINDER_PREFIX, ORDER_REMINDER_ROUTE, orderReminders } from "@/lib/orderReminderRules";

// Order reminders (2026-11-10): local notifications half an hour before a meal time stops taking
// orders ("Lunch orders close at 10:30 AM"), for today and tomorrow, skipping meal times already
// ordered. The phone schedules them itself: no push server, no Expo services, no cost. Off until
// the member turns them on (Home's Picked for you), which asks for notification permission.
// Rescheduled whenever Home shows; tapping one opens the Meals tab (lib/mealReminders.ts handles taps).

const KEY = "justfit.orderReminders";
const CHANNEL = "order-reminders";
const supported = Platform.OS !== "web";

export type OrderReminderSetting = "on" | "off" | "denied" | "failed";

export async function orderRemindersOn(): Promise<boolean> {
  if (!supported) return false;
  return (await SecureStore.getItemAsync(KEY).catch(() => null)) === "on";
}

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Order reminders", importance: AndroidImportance.DEFAULT });
}

async function cancelOrderReminders(): Promise<void> {
  if (!supported) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((r) => r.identifier.startsWith(ORDER_REMINDER_PREFIX)).map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier).catch(() => {})));
}

/**
 * Reads the meal times and the member's orders, then replaces the scheduled reminders. Does nothing
 * unless they're on and allowed. `pick`: a meal picked for the member, named in the first reminder.
 */
export async function refreshOrderReminders(token: string | null, pick: { name: string; price: number } | null): Promise<void> {
  if (!supported || !(await orderRemindersOn())) return;
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return;
  const [options, orders] = await Promise.all([mealsApi.options(token), mealsApi.orders(token)]);
  if (!options.ok || !orders.ok) return; // keep what's scheduled; tried again next time Home shows
  const ordered = new Set(orders.data.orders.filter((o) => o.status !== "cancelled").map((o) => `${o.date}:${o.slot}`));
  await ensureChannel();
  await cancelOrderReminders();
  for (const reminder of orderReminders({ days: options.data.days, ordered, pick, now: new Date() })) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { title: reminder.title, body: reminder.body, data: { url: ORDER_REMINDER_ROUTE } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL },
    }).catch(() => {});
  }
}

/** On (asks for permission, then schedules) or off (clears them). "denied" when the phone refuses. */
export async function setOrderRemindersOn(on: boolean, token: string | null, pick: { name: string; price: number } | null): Promise<OrderReminderSetting> {
  if (!supported) return "off";
  if (!on) {
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
    await cancelOrderReminders();
    return "off";
  }
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return "denied";
    await SecureStore.setItemAsync(KEY, "on");
    await refreshOrderReminders(token, pick);
    return "on";
  } catch {
    return "failed";
  }
}

// Signing out clears them and the setting: the next person on this phone gets none
onAccountCleared(() => {
  if (!supported) return;
  SecureStore.deleteItemAsync(KEY).catch(() => {});
  cancelOrderReminders().catch(() => {});
});
