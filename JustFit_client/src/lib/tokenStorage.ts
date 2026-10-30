import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Where the session token is kept between launches: the iOS Keychain or Android Keystore
// through expo-secure-store, readable only by justFit and not copied into device backups.
// expo-secure-store has no web version, so the web build (used by the UI tests) keeps it in
// the browser's localStorage instead. Nothing else stores the token, and it is never logged.
const KEY = "justfit.session";
const nativeOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY, nativeOptions);
}

export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === "web") return globalThis.localStorage?.setItem(KEY, token);
  await SecureStore.setItemAsync(KEY, token, nativeOptions);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === "web") return globalThis.localStorage?.removeItem(KEY);
  await SecureStore.deleteItemAsync(KEY, nativeOptions);
}
