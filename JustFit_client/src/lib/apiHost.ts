// Which computer the justFit server runs on in development, worked out from addresses the app
// already has. Pure: no React Native imports, so it is unit-tested on its own (lib/api.ts passes
// the real values in).
//
// In order:
//   1. hostUri ("10.20.0.121:8081"): set by Expo Go and development clients
//   2. the address the JavaScript bundle was loaded from ("http://10.20.0.121:8081/index.bundle?…"):
//      a local debug build (npm run ios|android) loads it from Metro on the developer's computer,
//      which is the same computer the server runs on
// A release build has neither (its bundle is a file inside the app), so it needs
// EXPO_PUBLIC_API_URL; without one this answers null and the caller falls back to localhost.
export function devServerHost(hostUri: string | null | undefined, scriptUrl: string | null | undefined): string | null {
  const fromHostUri = hostUri?.split(":")[0];
  if (fromHostUri) return fromHostUri;
  const match = typeof scriptUrl === "string" ? /^https?:\/\/([^/:?#]+)/.exec(scriptUrl) : null;
  return match ? match[1] : null;
}

// A release build must talk to the server over HTTPS only: the session token travels in every
// request, and a plain-HTTP address in a shipped app would hand it to anyone on the same
// Wi-Fi. A development build may use http:// (the Mac on the local network). Refusing here
// means every call fails with the "couldn't reach the server" line instead of leaking.
export function requireHttpsInRelease(url: string, isDevBuild: boolean): string {
  if (isDevBuild || /^https:\/\//i.test(url)) return url;
  throw new Error("EXPO_PUBLIC_API_URL must start with https:// in a release build");
}
