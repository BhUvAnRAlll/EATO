import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import { onAccountCleared } from "@/lib/accountScope";
import { CHECK_IN_HOUR, CHECK_IN_ID, CHECK_IN_MINUTE, CHECK_IN_ROUTE, checkInContent } from "@/lib/coachCheckInRules";

// The coach's daily check-in (2026-11-10): one local notification every evening at 8:30 pm, repeated
// by the phone itself (no push server, no Expo services, free). Off until the member turns it on
// on the Coach tab, which asks for notification permission. Tapping it opens the chat, where the
// coach writes today's check-in (lib/mealReminders.ts handles taps). Not on the web build.

const KEY = "justfit.coachCheckIns";
const CHANNEL = "coach-checkins";
const supported = Platform.OS !== "web";

export type CheckInSetting = "on" | "off" | "denied" | "failed";

export async function checkInsOn(): Promise<boolean> {
  if (!supported) return false;
  return (await SecureStore.getItemAsync(KEY).catch(() => null)) === "on";
}

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Coach check-ins", importance: AndroidImportance.DEFAULT });
}

async function schedule(coachName: string | null) {
  await Notifications.cancelScheduledNotificationAsync(CHECK_IN_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: CHECK_IN_ID,
    content: { ...checkInContent(coachName), data: { url: CHECK_IN_ROUTE } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: CHECK_IN_HOUR, minute: CHECK_IN_MINUTE, channelId: CHANNEL },
  });
}

/** Keeps the scheduled notification naming the member's coach now (after a change of coach). Quiet when off. */
export async function refreshCheckIns(coachName: string | null): Promise<void> {
  if (!supported || !(await checkInsOn())) return;
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return;
  await ensureChannel();
  await schedule(coachName).catch(() => {});
}

/** On (asks for permission, then schedules) or off (clears it). "denied" when the phone refuses. */
export async function setCheckInsOn(on: boolean, coachName: string | null): Promise<CheckInSetting> {
  if (!supported) return "off";
  if (!on) {
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(CHECK_IN_ID).catch(() => {});
    return "off";
  }
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return "denied";
    await schedule(coachName);
    await SecureStore.setItemAsync(KEY, "on");
    return "on";
  } catch {
    return "failed";
  }
}

// Signing out clears it and the setting: the next person on this phone gets none
onAccountCleared(() => {
  if (!supported) return;
  SecureStore.deleteItemAsync(KEY).catch(() => {});
  Notifications.cancelScheduledNotificationAsync(CHECK_IN_ID).catch(() => {});
});
