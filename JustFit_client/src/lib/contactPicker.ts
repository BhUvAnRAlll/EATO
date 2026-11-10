import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import { contactMobiles } from "@/lib/addressRules";

export type PickedContact = { name: string; mobiles: { digits: string; label: string }[] };
export type ContactPick =
  | { kind: "picked"; contact: PickedContact }
  | { kind: "cancelled" }
  | { kind: "denied" } // Android: contacts permission refused
  | { kind: "failed" };

// The phone's own contact picker (iPhone and Android; the web build has none). Nothing is read
// but the one contact chosen, and nothing is sent anywhere: the form only fills in its name and
// Indian mobile numbers.
// expo-contacts is native: a development build made before it was added has no ExpoContacts
// module, and importing the library there throws at startup. So it is loaded only when the
// build has it, and the button stays hidden until the app is rebuilt.
export const canPickContact = (Platform.OS === "ios" || Platform.OS === "android") && requireOptionalNativeModule("ExpoContacts") !== null;

// The legacy API on purpose: its picker hands back the chosen contact itself, so an iPhone needs
// no contacts permission at all (the newer class API reads the address book again after the pick)
function contacts(): typeof import("expo-contacts/legacy") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-contacts/legacy");
}

export async function pickContact(): Promise<ContactPick> {
  if (!canPickContact) return { kind: "failed" };
  try {
    const Contacts = contacts();
    // Android reads the picked contact from the address book, which needs the permission
    if (Platform.OS === "android") {
      const { granted } = await Contacts.requestPermissionsAsync();
      if (!granted) return { kind: "denied" };
    }
    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) return { kind: "cancelled" };
    const name = (contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ")).trim().slice(0, 60);
    return { kind: "picked", contact: { name, mobiles: contactMobiles(contact.phoneNumbers ?? []) } };
  } catch {
    return { kind: "failed" };
  }
}
