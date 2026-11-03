import { createElement } from "react";
import { View } from "react-native";

import { embedUrl, validLink, type YouTubeLink } from "./youtube";

// The web build: YouTube's player in a plain iframe (the phone build uses a web view)
export function YouTubeEmbed({ link, title }: { link: YouTubeLink; title: string }) {
  if (!validLink(link)) return null;
  return (
    <View className="overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: 16 / 9 }}>
      {createElement("iframe", {
        src: embedUrl(link),
        title: `${title} on YouTube`,
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        allowFullScreen: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        style: { border: 0, width: "100%", height: "100%" },
      })}
    </View>
  );
}
