import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import { onAccountCleared } from "@/lib/accountScope";
import { mealsApi } from "@/lib/mealsApi";
import { CART_REMINDER_DELAY_MIN, CART_REMINDER_ID, CART_ROUTE, ORDER_REMINDER_PREFIX, ORDER_REMINDER_ROUTE, cartReminderText, orderReminders } from "@/lib/orderReminderRules";
import { useCartStore } from "@/store/cart";
import { useStorefront } from "@/store/storefront";

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
  // The cart reminder has its own timing (below): a reschedule of the meal times leaves it alone
  await Promise.all(scheduled.filter((r) => r.identifier.startsWith(ORDER_REMINDER_PREFIX) && r.identifier !== CART_REMINDER_ID).map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier).catch(() => {})));
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
    await Notifications.cancelScheduledNotificationAsync(CART_REMINDER_ID).catch(() => {});
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

// Cart reminder (marketing phase 3c): with order reminders on, meals left in the cart get one nudge
// 45 minutes after the cart last changed; an empty cart (the order placed, or cleared) cancels it.
// The cart is watched for the app's lifetime; changes within 2 s are taken together.
let cartTimer: ReturnType<typeof setTimeout> | null = null;
async function syncCartReminder(): Promise<void> {
  if (!supported) return;
  await Notifications.cancelScheduledNotificationAsync(CART_REMINDER_ID).catch(() => {});
  if (!(await orderRemindersOn())) return;
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return;
  const menu = useStorefront.getState().load;
  const names = Object.keys(useCartStore.getState().items).map((id) => (menu.state === "ready" ? menu.data.meals.find((m) => m.id === id)?.name : null) ?? "meal");
  const text = cartReminderText(names);
  if (!text) return;
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: CART_REMINDER_ID,
    content: { title: text.title, body: text.body, data: { url: CART_ROUTE } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + CART_REMINDER_DELAY_MIN * 60000), channelId: CHANNEL },
  }).catch(() => {});
}
if (supported) {
  useCartStore.subscribe((state, before) => {
    if (state.items === before.items) return;
    if (cartTimer) clearTimeout(cartTimer);
    cartTimer = setTimeout(() => { syncCartReminder().catch(() => {}); }, 2000);
  });
}

// Signing out clears them and the setting: the next person on this phone gets none
onAccountCleared(() => {
  if (!supported) return;
  SecureStore.deleteItemAsync(KEY).catch(() => {});
  cancelOrderReminders().catch(() => {});
  Notifications.cancelScheduledNotificationAsync(CART_REMINDER_ID).catch(() => {});
});
