import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { AndroidImportance, AndroidNotificationPriority } from "expo-notifications";

import { onAccountCleared } from "@/lib/accountScope";
import type { WorkoutStatus } from "@/lib/workoutStatus";

// Android's ongoing workout notification (step 7 of the native interactions plan, 2026-11-09):
// while the session player is open, a quiet notification that can't be swiped away shows the set
// or rest in progress and the sets done ("Bench Press · set 2 of 4"). It is replaced as each step
// changes and removed when the workout ends, the player closes or the member signs out. Local
// only: no push server and no Expo services. Tapping it brings justFit back to the player, which
// is still open underneath (the notification only exists while it is). iPhone gets a Live
// Activity instead; the web build has neither.

const ID = "justfit-workout";
const CHANNEL = "workout";
const supported = Platform.OS === "android";
let asked = false;

async function allowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  // Asked at most once per app session, when a workout starts (Android 13+ needs it)
  if (asked || !current.canAskAgain) return false;
  asked = true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

let ready: Promise<boolean> | null = null;
function prepare(): Promise<boolean> {
  ready ??= (async () => {
    // LOW: no sound, no pop-up, just the line in the shade and the icon in the status bar
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Workout in progress", importance: AndroidImportance.LOW, showBadge: false });
    return allowed();
  })().catch(() => false);
  return ready;
}

export async function showWorkoutNotification(status: WorkoutStatus): Promise<void> {
  if (!supported || !(await prepare())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: ID,
    content: {
      title: status.title,
      body: status.body,
      sticky: true,
      autoDismiss: false,
      priority: AndroidNotificationPriority.LOW,
      data: { kind: "workout" },
    },
    trigger: { channelId: CHANNEL },
  }).catch(() => {});
}

export async function hideWorkoutNotification(): Promise<void> {
  if (!supported) return;
  await Notifications.dismissNotificationAsync(ID).catch(() => {});
}

// The next person on this phone never sees another member's workout
onAccountCleared(() => void hideWorkoutNotification());
// An app closed mid-workout (or stopped by the system) leaves no notification at the next launch
void hideWorkoutNotification();
