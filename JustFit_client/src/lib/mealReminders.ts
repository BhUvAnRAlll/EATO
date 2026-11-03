import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import { onAccountCleared } from "@/lib/accountScope";
import type { CoachPlan } from "@/lib/coach";
import { REMINDER_PREFIX, mealReminders } from "@/lib/mealReminderRules";

// Meal reminders: local notifications on the phone at each of today's planned meal times ("Lunch
// at 1:30 PM"), scheduled from the coach's plan. Nothing goes through a push server or Expo's
// services; tapping one opens the Meal Plan to log it. Off until the member turns them on (Meal
// Plan screen), which asks for notification permission. The web build has no notifications.
//
// The plan is per day, so reminders are scheduled for today whenever the plan is read (the Macro
// tab, the Coach tab, the Meal Plan screen) and again after a meal is logged or swapped.

const KEY = "justfit.mealReminders";
const CHANNEL = "meal-reminders";
const supported = Platform.OS !== "web";
// The only place a reminder may open: a tapped notification's data is checked against this,
// never routed as given
const REMINDER_ROUTE = "/coach/meal-plan";

export type ReminderSetting = "on" | "off" | "denied";

export async function remindersOn(): Promise<boolean> {
  if (!supported) return false;
  return (await SecureStore.getItemAsync(KEY).catch(() => null)) === "on";
}

// Android 8+ files notifications under a channel the member can tune in Settings; Android 13+
// only shows the permission prompt once a channel exists
async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Meal reminders", importance: AndroidImportance.DEFAULT });
}

export async function cancelMealReminders(): Promise<void> {
  if (!supported) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((request) => request.identifier.startsWith(REMINDER_PREFIX)).map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => {})));
}

// Turns reminders on (asking for permission) or off (clearing any scheduled). Answers "denied"
// when the phone refuses, so the screen can point the member to Settings.
export async function setRemindersOn(on: boolean, plan: CoachPlan | null, date: string): Promise<ReminderSetting> {
  if (!supported) return "off";
  if (!on) {
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
    await cancelMealReminders();
    return "off";
  }
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return "denied";
  await SecureStore.setItemAsync(KEY, "on");
  await syncMealReminders(plan, date);
  return "on";
}

// Today's reminders, from the plan as it is now: everything scheduled before is replaced, so a
// logged, swapped or remade meal never fires a stale reminder
export async function syncMealReminders(plan: CoachPlan | null, date: string): Promise<void> {
  if (!supported || !(await remindersOn())) return;
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return;
  await ensureChannel();
  await cancelMealReminders();
  if (!plan) return;
  for (const reminder of mealReminders(plan.meals, date, new Date())) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { title: reminder.title, body: reminder.body, data: { url: REMINDER_ROUTE } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL },
    }).catch(() => {});
  }
}

// Signing out (or in as someone else) clears the reminders and the setting: the next person on
// this phone never gets another member's meals
onAccountCleared(() => {
  if (!supported) return;
  SecureStore.deleteItemAsync(KEY).catch(() => {});
  cancelMealReminders().catch(() => {});
});

// A reminder that arrives while justFit is open still shows as a banner (no sound or badge)
if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

// Opens the Meal Plan when a meal reminder is tapped, including the tap that launched the app.
// `ready`: a member is signed in (a tap before that waits; it's kept until then).
export function useMealReminderTaps(ready: boolean) {
  useEffect(() => {
    if (!supported || !ready) return;
    const open = (notification: Notifications.Notification) => {
      if (notification.request.content.data?.url !== REMINDER_ROUTE) return;
      router.push(REMINDER_ROUTE);
      Notifications.clearLastNotificationResponse();
    };
    const last = Notifications.getLastNotificationResponse();
    if (last?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) open(last.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) open(response.notification);
    });
    return () => subscription.remove();
  }, [ready]);
}
