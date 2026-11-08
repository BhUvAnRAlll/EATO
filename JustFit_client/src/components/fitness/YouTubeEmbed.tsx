import type { ComponentType } from "react";
import { Linking, NativeModules, TurboModuleRegistry, View } from "react-native";

import { embedUrl, validLink, watchUrl, type YouTubeLink } from "./youtube";
import { useThemeColors } from "@/theme";

// The web view is native code: an app built before it was added doesn't have it, and importing
// it there throws. So it's loaded only when the build has it; without it the player is left out
// (the screen's "Watch on YouTube" link still works) until the app is rebuilt.
const hasWebView = (() => {
  try {
    return Boolean(TurboModuleRegistry.get("RNCWebViewModule") ?? NativeModules.RNCWebViewModule);
  } catch {
    return false;
  }
})();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebView: ComponentType<Record<string, unknown>> | null = hasWebView ? require("react-native-webview").WebView : null;

// YouTube asks apps that embed its player in a web view to send their app ID as the referrer
// (https://<bundle id>); without one some videos refuse to play.
const APP_ORIGIN = "https://com.bhuvii3.justfit";

// Only YouTube's own player (and the Google pages it loads inside itself) may load in the frame
const PLAYER_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(youtube-nocookie\.com|youtube\.com|google\.com|googlevideo\.com|ytimg\.com|gstatic\.com|doubleclick\.net)(\/|$)/i;

const page = (src: string, background: string) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:${background}}iframe{border:0;width:100%;height:100%}</style></head>
<body><iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;

/**
 * A YouTube playlist or one video in YouTube's own player (16:9). The ID was checked by the
 * server and is checked again here, so nothing but YouTube's player reaches the page. Anything that tries to leave
 * the player (the YouTube logo, "Watch on YouTube", a video's title) opens in the YouTube app or
 * the browser instead of inside justFit.
 */
export function YouTubeEmbed({ link, title }: { link: YouTubeLink; title: string }) {
  const colors = useThemeColors();
  if (!WebView || !validLink(link)) return null;
  const leave = (request: { url: string; isTopFrame?: boolean }) => {
    const { url } = request;
    if (url === "about:blank" || url.startsWith(APP_ORIGIN)) return true;
    if (request.isTopFrame === false && PLAYER_HOSTS.test(url)) return true;
    if (url.startsWith("https://")) Linking.openURL(url).catch(() => Linking.openURL(watchUrl(link)).catch(() => {}));
    return false;
  };
  return (
    <View className="overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: 16 / 9 }} accessibilityLabel={`${title} on YouTube`}>
      <WebView
        source={{ html: page(embedUrl(link), colors.black), baseUrl: APP_ORIGIN }}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={leave}
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        allowsAirPlayForMediaPlayback
        mediaPlaybackRequiresUserAction
        javaScriptCanOpenWindowsAutomatically={false}
        scrollEnabled={false}
        bounces={false}
        style={{ backgroundColor: colors.black }}
      />
    </View>
  );
}
