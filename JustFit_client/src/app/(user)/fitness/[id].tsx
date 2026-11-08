import { useCallback, useRef, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { IconButton } from "@/components/IconButton";
import { PressableScale } from "@/components/PressableScale";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { YouTubeEmbed } from "@/components/fitness/YouTubeEmbed";
import { GOOGLE_PRIVACY_URL, watchUrl, YOUTUBE_TERMS_URL, type YouTubeLink } from "@/components/fitness/youtube";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { fitnessApi, LEVEL_TEXT, sessionMinutes, type ProgramDetail, type ProgramSession } from "@/lib/fitnessApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; program: ProgramDetail };

const back = () => (router.canGoBack() ? router.back() : router.replace("/workout"));
// One session: its YouTube video in YouTube's own player, its title, "creator · YouTube · minutes",
// Watch on YouTube, and the creator's credit with YouTube's terms (the video is theirs, never
// re-hosted or uploaded)
function SessionCard({ session, index }: { session: ProgramSession; index: number }) {
  const colors = useThemeColors();
  const link: YouTubeLink = { kind: "video", id: session.video.id };
  const by = [session.video.channel, "YouTube", `${session.minutes} min`].filter(Boolean).join(" · ");
  return (
    <View className="session-video">
      <YouTubeEmbed link={link} title={session.title} />
      <View className="gap-3 p-4">
        <View className="gap-0.5">
          <Text className="type-overline text-faint">{`Session ${index + 1}`}</Text>
          <Text className="session-video__title" numberOfLines={2}>{session.title}</Text>
          <Text className="meta-text" numberOfLines={1}>{by}</Text>
        </View>
        <PressableScale onPress={() => Linking.openURL(watchUrl(link)).catch(() => {})} className="btn-forest" accessibilityRole="link" accessibilityLabel={`Watch ${session.title} on YouTube`}>
          <SymbolView name={{ ios: "arrow.up.right.square", android: "open_in_new", web: "open_in_new" }} size={16} tintColor={colors.onPrimary} />
          <Text className="btn-forest__label">Watch on YouTube</Text>
        </PressableScale>
        <Text className="meta-text" style={{ fontSize: 12, lineHeight: 17 }}>
          {session.video.channel ? `Video by ${session.video.channel} on YouTube, not made by justFit. ` : "Video on YouTube, not made by justFit. "}
          {"Playing it means you agree to the "}
          <Text style={{ textDecorationLine: "underline" }} onPress={() => Linking.openURL(YOUTUBE_TERMS_URL).catch(() => {})} accessibilityRole="link">YouTube Terms of Service</Text>
          {". "}
          <Text style={{ textDecorationLine: "underline" }} onPress={() => Linking.openURL(GOOGLE_PRIVACY_URL).catch(() => {})} accessibilityRole="link">Google Privacy Policy</Text>
          {"."}
        </Text>
      </View>
    </View>
  );
}

const PLACE_TEXT = { home: "At home", center: "At the center", both: "Home or center" } as const;
const KIT_NOTE = { none: "No equipment", some: "Some equipment", full_gym: "Full gym" } as const;

// Under the picture: how many sessions, how long each is, and where (with the equipment)
function InfoStrip({ program }: { program: ProgramDetail }) {
  const colors = useThemeColors();
  const items: { icon: Icon; title: string; note: string }[] = [
    { icon: { ios: "play.rectangle", android: "smart_display", web: "smart_display" }, title: `${program.sessionCount} ${program.sessionCount === 1 ? "session" : "sessions"}`, note: "free" },
    { icon: { ios: "clock", android: "schedule", web: "schedule" }, title: sessionMinutes(program), note: "per session" },
    { icon: program.place === "center" ? { ios: "dumbbell", android: "fitness_center", web: "fitness_center" } : { ios: "house", android: "home", web: "home" }, title: PLACE_TEXT[program.place], note: KIT_NOTE[program.kit] },
  ];
  return (
    <View className="program-info">
      {items.map((item, i) => (
        <View key={item.note} className={i > 0 ? "program-info__item program-info__item--split" : "program-info__item"}>
          <View className="program-info__icon">
            <SymbolView name={item.icon} size={18} tintColor={colors.leaf} />
          </View>
          <Text className="program-info__title" numberOfLines={1}>{item.title}</Text>
          <Text className="program-info__note text-center" numberOfLines={2}>{item.note}</Text>
        </View>
      ))}
    </View>
  );
}

// A Fitness program: its picture at the top, nothing written on it (the admin's page photo, never
// the card's cover; the gradient without one), the info strip, what it is, then Follow along: its
// sessions, each a YouTube video the admin added. Every program is free.
export default function ProgramScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const latest = useRef(0);

  // A re-read on focus that fails keeps the program already on screen; a stale answer is dropped
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    const result = await fitnessApi.program(await getToken().catch(() => null), String(id));
    if (request !== latest.current) return;
    setLoad((current) => (result.ok ? { state: "ready", program: result.data } : current.state === "ready" ? current : { state: "failed", error: result.error }));
  }, [getToken, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style={load.state === "ready" ? "light" : "auto"} />
      {load.state === "loading" ? (
        <View className="px-4" style={{ paddingTop: insets.top + 56 }}>
          <ScreenSkeleton cards={2} hero label="Loading the program" />
        </View>
      ) : load.state === "failed" ? (
        <View className="px-4" style={{ paddingTop: insets.top + 56 }}>
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not open the program" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {/* The top: the picture alone (the page photo carries its own design); screen readers hear the title */}
          <View style={{ height: 280 + insets.top }} className="overflow-hidden" accessible accessibilityRole="header" accessibilityLabel={`${load.program.title}. ${load.program.subtitle}. ${LEVEL_TEXT[load.program.level]}, free.`}>
            <ProgramArt palette={load.program.palette} icon={load.program.icon} iconSize={96} id={`detail-${load.program.id}`} coverUrl={load.program.heroUrl} shade={false} />
          </View>

          <View className="gap-5 px-4 pt-4">
            <InfoStrip program={load.program} />
            {load.program.description ? <Text className="text-forest-ink" style={{ fontSize: 15, lineHeight: 23 }}>{load.program.description}</Text> : null}
            <View className="flex-row items-center gap-3">
              <Text className="fitness-section__title min-w-0 flex-1" accessibilityRole="header">Follow along</Text>
              <Text className="session-video__note">{"Watch and do the\nworkout on YouTube"}</Text>
            </View>
            {load.program.sessions.length === 0 ? (
              <View className="session-video items-center gap-1 p-6">
                <SymbolView name={{ ios: "play.rectangle", android: "smart_display", web: "smart_display" }} size={28} tintColor={colors.faint} />
                <Text className="session-video__title">Sessions are on their way</Text>
                <Text className="meta-text text-center">The videos for this program will show here soon.</Text>
              </View>
            ) : (
              load.program.sessions.map((s, i) => <SessionCard key={s.id} session={s} index={i} />)
            )}
          </View>
        </ScrollView>
      )}
      <View className="absolute left-4" style={{ top: insets.top + 8 }}>
        <IconButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={back} />
      </View>
    </View>
  );
}
