import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import { router, useLocalSearchParams } from "expo-router";

import { SetupScreen } from "@/components/setup/SetupScreen";
import { videos } from "@/constants/videos";
import { useThemeColors } from "@/theme";

// The instruction video plays by itself on a loop, with no controls. On phones it plays with
// sound; browsers block autoplay with sound, so on the web it plays muted. It stops when the
// screen closes.
function InstructionVideo() {
  const colors = useThemeColors();
  // The width the card gives the video, measured, so the 9:16 box fits it exactly
  const [width, setWidth] = useState(0);
  const player = useVideoPlayer(videos.scanInstructions, (p) => {
    p.loop = true;
    p.muted = Platform.OS === "web";
    p.play();
  });
  // A play() before the video has loaded can be dropped, so start it again once it is ready
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "readyToPlay" && !player.playing) player.play();
  });
  // The box has the video's own shape (portrait 9:16), so the whole video fills it with no bars
  const height = Math.round((width * 16) / 9);
  return (
    <View className="setup__card gap-2.5" style={{ paddingBottom: 12 }}>
      <View className="flex-row items-center gap-2">
        <SymbolView name={{ ios: "play.rectangle", android: "smart_display", web: "smart_display" }} size={18} tintColor={colors.leaf} />
        <Text className="setup__card-title">Watch first</Text>
      </View>
      <Text className="setup__card-text">A short video on how to stand and what to wear.</Text>
      <View className="overflow-hidden rounded-lg" style={{ height: width > 0 ? height : 0 }} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}>
        <VideoView
          player={player}
          style={{ width: "100%", height }}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          accessibilityLabel="Body scan instruction video"
        />
      </View>
    </View>
  );
}

// Shown after "Scan Body": the instruction video (how to stand and what to wear), then on to the scan
export default function ScanGuide() {
  const colors = useThemeColors();
  // ?from=profile: the same scan, opened from Profile after setup (no setup progress)
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromProfile = from === "profile";

  return (
    <SetupScreen
      step="body-composition"
      title="How to take your photos"
      subtitle="Watch how to stand and what to wear, then take your two photos."
      onNext={() => router.replace(fromProfile ? "/setup/body-scan?from=profile" : "/setup/body-scan")}
      nextLabel="Start scan"
      onBack={() => (router.canGoBack() ? router.back() : router.replace(fromProfile ? "/profile" : "/setup/body-composition"))}
      showProgress={!fromProfile}
    >
      <View className="gap-3">
        <InstructionVideo />

        <View className="setup__note">
          <SymbolView name={{ ios: "lock.shield", android: "shield", web: "shield" }} size={22} tintColor={colors.leaf} />
          <View className="flex-1 gap-0.5">
            <Text className="setup__note-title">Your photos stay private</Text>
            <Text className="setup__note-text">
              They are analysed and discarded, never stored. The result is an estimate, not a medical measurement.
            </Text>
          </View>
        </View>
      </View>
    </SetupScreen>
  );
}
