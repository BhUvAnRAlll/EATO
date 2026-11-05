import { Alert, Platform } from "react-native";

// A short message with a title: an alert on phones, the browser's alert on the web build
export function notice(title: string, text: string) {
  if (Platform.OS === "web") globalThis.alert?.(`${title}\n\n${text}`);
  else Alert.alert(title, text);
}

// The gym admin portal's buttons whose screens aren't built yet (Send Bulk SMS, members, the AI
// assistant and so on) say so plainly instead of doing nothing.
export function comingSoon(what: string) {
  notice(what, "This part of the gym portal is coming soon.");
}

// Asks before something that can't be undone; resolves true when confirmed
export function confirmAction(title: string, text: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${text}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, text, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}
