import { Alert, Platform } from "react-native";

// The gym admin portal's buttons whose screens aren't built yet (Send Bulk SMS, members, the AI
// assistant and so on) say so plainly instead of doing nothing.
export function comingSoon(what: string) {
  const text = "This part of the gym portal is coming soon.";
  if (Platform.OS === "web") globalThis.alert?.(`${what}\n\n${text}`);
  else Alert.alert(what, text);
}
