import { ActionSheetIOS, Alert, Platform } from "react-native";

import { haptic } from "@/lib/haptics";
import { iosButtons } from "@/lib/nativeSheetRules";
import { useActionSheetStore, type SheetAction } from "@/store/actionSheet";
import { colors } from "@/theme";

export type { SheetAction };

// The platform's own way to offer a few actions or ask before one:
//   iPhone   UIKit's action sheet, rising from the bottom, destructive buttons in red, Cancel apart
//   Android  the Material dialog for a question; the app's bottom sheet for a list of actions
//   web      the browser's confirm(); the app's bottom sheet for a list of actions
// Cancelling, tapping outside or Android back always means "do nothing".

type ActionsSheet = { title?: string; message?: string; actions: SheetAction[] };

// A short list of actions for one thing (an exercise's options). Cancel is added by itself.
export function showActions({ title, message, actions }: ActionsSheet) {
  if (actions.length === 0) return;
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        ...iosButtons(actions),
        tintColor: colors.ink,
        userInterfaceStyle: "light",
      },
      (index) => actions[index]?.onPress(),
    );
    return;
  }
  useActionSheetStore.getState().open({ title, message, actions });
}

type Choice = {
  title: string;
  message?: string;
  // The button that goes ahead ("Remove", "Sign out")
  confirmLabel: string;
  cancelLabel?: string;
  // Deletes, replaces or signs out: red, and a warning buzz as it opens (the default)
  destructive?: boolean;
};

// Asks before an action; resolves true only when the person taps the confirm button
export function confirmChoice({ title, message, confirmLabel, cancelLabel = "Cancel", destructive = true }: Choice): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(message ? `${title}\n\n${message}` : title) ?? false);
  if (destructive) haptic.warning();
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message,
          ...iosButtons([{ label: confirmLabel, destructive }], cancelLabel),
          tintColor: colors.ink,
          userInterfaceStyle: "light",
        },
        (index) => resolve(index === 0),
      );
      return;
    }
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
