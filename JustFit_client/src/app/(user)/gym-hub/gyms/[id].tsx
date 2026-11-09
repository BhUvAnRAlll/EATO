import { useCallback, useState } from "react";
import { Linking, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { JoinSheet, type JoinPick } from "@/components/gymHub/JoinSheet";
import { discoverApi, type GymPage, type JoinRequest } from "@/lib/discoverApi";
import { directionsUrl, facilityLabel, indiaNow, joinStateText, openNow, perMonthText, planLengthText, priceText } from "@/lib/gymDiscover";
import { DAYS, dayText, timeLabel } from "@/lib/gymProfile";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string; missing: boolean } | { state: "ready"; gym: GymPage; at: number };

// Gym Hub › Discover Gyms › a gym (phase 3, 2026-11-09): what the gym chose to show members. Its
// photos, name and logo, open now, Call and Directions (the phone's own apps), about, facilities,
// the week's hours, the membership plans laid out to compare (price, a month, the saving on the
// shortest plan, what each includes), PT packages, and the address. No buying: since phase 4 the
// member asks the gym to call them about a plan (Ask about this plan, or Ask to join), which lands
// in the gym's Enquiries; the page then shows the request, or that they are a member here.
export default function GymDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [result, setResult] = useState<Load>({ state: "loading" });
  const [pick, setPick] = useState<JoinPick | null>(null);

  const load = useCallback(async () => {
    const answer = await discoverApi.gym(await getToken().catch(() => null), Number(id));
    setResult((current) => (answer.ok ? { state: "ready", gym: answer.data, at: Date.now() } : current.state === "ready" ? current : { state: "failed", error: answer.error, missing: answer.status === 404 || answer.status === 400 }));
  }, [getToken, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { refreshControl } = usePullToRefresh(load);

  const insets = useSafeAreaInsets();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-hub"));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title={result.state === "ready" ? result.gym.name : "Gym"} subtitle={result.state === "ready" ? `${result.gym.branch} branch` : undefined} onBack={back} />
        {result.state === "loading" ? (
          <View className="p-4"><ScreenSkeleton cards={3} label="Loading the gym" hero /></View>
        ) : result.state === "failed" ? (
          <View className="p-4">
            <View className="card" style={{ gap: 12 }}>
              <FormAlert message={result.error} />
              {result.missing ? <PrimaryButton label="Back to Gym Hub" onPress={back} /> : <PrimaryButton label="Try again" onPress={() => { setResult({ state: "loading" }); load(); }} />}
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom, gap: 16 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
            <Photos gym={result.gym} />
            <Identity gym={result.gym} at={result.at} />
            {result.gym.about ? <Text className="type-body text-ink">{result.gym.about}</Text> : null}
            <Facilities gym={result.gym} />
            <Hours gym={result.gym} at={result.at} />
            <Standing gym={result.gym} />
            <Plans gym={result.gym} onAsk={setPick} />
            <Place gym={result.gym} />
          </ScrollView>
        )}
        {pick && result.state === "ready" && (
          <JoinSheet
            gymId={result.gym.id}
            gymName={result.gym.name}
            pick={pick}
            onClose={() => setPick(null)}
            onSent={(request: JoinRequest) => setResult((current) => (current.state === "ready" ? { ...current, gym: { ...current.gym, you: { ...current.gym.you, request } } } : current))}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const open = (url: string, failed: string) => Linking.openURL(url).catch(() => hud.error(failed));

function Photos({ gym }: { gym: GymPage }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  if (gym.photos.length === 0) return null;
  const tile = Math.min(width, 760) - 32;
  return (
    <View style={{ gap: 6 }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / tile))}
        style={{ width: tile }}
        accessibilityLabel={`${gym.photos.length} photos of ${gym.name}`}
      >
        {gym.photos.map((p, i) => (
          <View key={p.id} className="hub-gym-photo" style={{ width: tile }} accessible accessibilityLabel={`Photo ${i + 1} of ${gym.photos.length}`}>
            <MemberPhotoImage url={p.url} />
          </View>
        ))}
      </ScrollView>
      {gym.photos.length > 1 && <Text className="type-caption text-muted text-center">{`${index + 1} / ${gym.photos.length}`}</Text>}
    </View>
  );
}

// at: when the page was read (open now and today follow it; pull to refresh reads again)
function Identity({ gym, at }: { gym: GymPage; at: number }) {
  const colors = useThemeColors();
  const now = openNow(gym.hours, at);
  return (
    <View className="card" style={{ gap: 12 }}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="card__icon" style={{ overflow: "hidden" }}>
          {gym.logoUrl ? <MemberPhotoImage url={gym.logoUrl} fit="contain" /> : <SymbolView name={{ ios: "building.2", android: "location_city", web: "location_city" }} size={20} tintColor={colors.leaf} />}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="card__title" numberOfLines={2}>{`${gym.name} · ${gym.branch}`}</Text>
          <Text className="card__subtitle" numberOfLines={1}>{[gym.area, gym.city].filter((v, i, all) => all.indexOf(v) === i).join(", ")}</Text>
        </View>
      </View>
      {now && (
        <View className={`badge badge--${now.open ? "active" : "paused"} self-start`}>
          <Text className={`badge__label badge__label--${now.open ? "active" : "paused"}`}>{now.line}</Text>
        </View>
      )}
      <View className="flex-row" style={{ gap: 8 }}>
        {gym.contact.phone && (
          <PressableScale onPress={() => open(`tel:+91${gym.contact.phone}`, "Couldn't open the phone app")} className="admin-chip flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`Call ${gym.name}`}>
            <SymbolView name={{ ios: "phone", android: "call", web: "call" }} size={14} tintColor={colors.leaf} />
            <Text className="admin-segment__label admin-segment__label--on">Call</Text>
          </PressableScale>
        )}
        <PressableScale onPress={() => open(directionsUrl(gym), "Couldn't open maps")} className="admin-chip flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`Directions to ${gym.name}`}>
          <SymbolView name={{ ios: "mappin.and.ellipse", android: "directions", web: "directions" }} size={14} tintColor={colors.leaf} />
          <Text className="admin-segment__label admin-segment__label--on">Directions</Text>
        </PressableScale>
      </View>
    </View>
  );
}

function Facilities({ gym }: { gym: GymPage }) {
  if (gym.facilities.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Facilities</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {gym.facilities.map((f) => (
          <View key={f} className="address-tag">
            <Text className="address-tag__label">{facilityLabel(f)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Hours({ gym, at }: { gym: GymPage; at: number }) {
  const colors = useThemeColors();
  if (!gym.hours) return null;
  const today = indiaNow(at).day;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Opening hours</Text>
      <View className="card" style={{ paddingVertical: 4 }}>
        {DAYS.map((d, i) => {
          const isToday = d.id === today;
          return (
            <View key={d.id} className="flex-row justify-between" style={{ gap: 12, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderColor: colors.line }} accessible accessibilityLabel={`${d.label}${isToday ? ", today" : ""}: ${dayText(gym.hours![d.id])}`}>
              <Text className={isToday ? "type-body text-ink" : "type-body text-muted"} style={isToday ? { fontFamily: "Poppins-SemiBold" } : undefined}>{isToday ? `${d.label} (today)` : d.label}</Text>
              {/* A session a line, so a time never breaks in the middle on a narrow phone */}
              <View className="items-end" style={{ flexShrink: 1 }}>
                {(gym.hours![d.id].length === 0 ? [null] : gym.hours![d.id]).map((s, k) => (
                  <Text key={k} className={isToday ? "type-body text-ink" : "type-body text-muted"} style={{ textAlign: "right" }}>{s ? `${timeLabel(s[0])} – ${timeLabel(s[1])}` : "Closed"}</Text>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Whether a request can be sent now: not while one is waiting (the server refuses it too)
const asking = (gym: GymPage) => gym.you.request !== null && (gym.you.request.state === "sent" || gym.you.request.state === "in_touch");

// Already a member here (a link to the membership), or the request waiting with the gym
function Standing({ gym }: { gym: GymPage }) {
  const colors = useThemeColors();
  if (gym.you.memberId !== null) {
    return (
      <PressableScale onPress={() => router.push({ pathname: "/gym-hub/[id]", params: { id: String(gym.you.memberId) } })} className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel={`You're a member at ${gym.name}. Open your membership`}>
        <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={18} tintColor={colors.success} />
        <View className="min-w-0 flex-1">
          <Text className="card__title">{"You're a member here"}</Text>
          <Text className="card__subtitle">Your plan, visits and pauses</Text>
        </View>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
      </PressableScale>
    );
  }
  const request = gym.you.request;
  if (!request || !asking(gym)) return null;
  const words = joinStateText(request.state, gym.name);
  return (
    <View className="card" style={{ gap: 8 }} accessible accessibilityLabel={`Your request: ${words.label}. ${words.line}`}>
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="card__title">Your request</Text>
        <View className={`badge badge--${words.tone}`}><Text className={`badge__label badge__label--${words.tone}`}>{words.label}</Text></View>
      </View>
      <Text className="type-body text-ink">{words.line}</Text>
      <Text className="type-caption text-muted">{request.planLabel ? `About ${request.planLabel}` : "About joining"}</Text>
    </View>
  );
}

// The plans side by side in words: the best value a month outlined, each with its saving and what it includes
function Plans({ gym, onAsk }: { gym: GymPage; onAsk: (pick: JoinPick) => void }) {
  const colors = useThemeColors();
  // Plans can be asked about by anyone not a member here; PT by members too
  const canAskPlan = gym.you.memberId === null && !asking(gym);
  const canAskPt = !asking(gym);
  const best = gym.plans.length > 1 ? Math.min(...gym.plans.map((p) => p.perMonth ?? Infinity)) : null;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Membership plans</Text>
      {gym.plans.length === 0 ? (
        <Text className="type-caption text-muted">{`${gym.name} hasn't listed its plans on justFit yet. Ask at the front desk.`}</Text>
      ) : (
        <>
          {gym.plans.length > 1 && <Text className="type-caption text-muted">Compare the price a month: longer plans usually cost less.</Text>}
          {gym.plans.map((p) => {
            const isBest = best !== null && p.perMonth === best;
            return (
              <View key={p.id} className={isBest ? "hub-plan hub-plan--best" : "hub-plan"} accessible accessibilityLabel={`${p.name}, ${planLengthText(p.months, p.days)}, ${priceText(p.price)}, ${perMonthText(p.perMonth)}${p.savesPerMonth ? `, saves ${priceText(p.savesPerMonth)} a month` : ""}${isBest ? ", best value" : ""}${p.details ? `. Includes: ${p.details}` : ""}`}>
                <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
                  <View className="min-w-0 flex-1">
                    <Text className="card__title" numberOfLines={2}>{p.name}</Text>
                    <Text className="type-caption text-muted">{planLengthText(p.months, p.days)}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="type-headline text-ink">{priceText(p.price)}</Text>
                    <Text className="type-caption text-muted">{perMonthText(p.perMonth)}</Text>
                  </View>
                </View>
                {(isBest || p.savesPerMonth > 0) && (
                  <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                    {isBest && <View className="badge badge--active"><Text className="badge__label badge__label--active">Best value</Text></View>}
                    {p.savesPerMonth > 0 && <Text className="type-caption" style={{ color: colors.success }}>{`Saves ${priceText(p.savesPerMonth)} a month`}</Text>}
                  </View>
                )}
                {p.details ? <Text className="type-caption text-ink">{p.details}</Text> : null}
                {canAskPlan && (
                  <PressableScale onPress={() => onAsk({ itemId: p.id, label: `${p.name} · ${planLengthText(p.months, p.days)} · ${priceText(p.price)}` })} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Ask about ${p.name}`}>
                    <Text className="auth__note-link">Ask about this plan</Text>
                  </PressableScale>
                )}
              </View>
            );
          })}
        </>
      )}
      {gym.pt.length > 0 && (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text className="type-subhead text-ink">Personal training</Text>
          {gym.pt.map((p) => (
            <View key={p.id} className="hub-plan" accessible accessibilityLabel={`${p.name}, ${planLengthText(p.months)}, ${priceText(p.price)}${p.details ? `. Includes: ${p.details}` : ""}`}>
              <View className="flex-row justify-between" style={{ gap: 8 }}>
                <Text className="card__title min-w-0 flex-1" numberOfLines={2}>{p.name}</Text>
                <Text className="type-body text-ink">{priceText(p.price)}</Text>
              </View>
              {p.months ? <Text className="type-caption text-muted">{planLengthText(p.months)}</Text> : null}
              {p.details ? <Text className="type-caption text-ink">{p.details}</Text> : null}
              {canAskPt && (
                <PressableScale onPress={() => onAsk({ itemId: p.id, label: `PT · ${p.name} · ${priceText(p.price)}` })} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Ask about ${p.name}`}>
                  <Text className="auth__note-link">Ask about this package</Text>
                </PressableScale>
              )}
            </View>
          ))}
        </View>
      )}
      {canAskPlan && <PrimaryButton label="Ask to join" onPress={() => onAsk({ itemId: null, label: null })} />}
      <Text className="type-caption text-muted">{canAskPlan ? "The gym calls you to help you join. You pay the gym, not the app." : "Prices are set by the gym. You pay the gym, not the app."}</Text>
    </View>
  );
}

function Place({ gym }: { gym: GymPage }) {
  const colors = useThemeColors();
  if (!gym.contact.address && !gym.contact.phone) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Address and contact</Text>
      <View className="card" style={{ gap: 8 }}>
        {gym.contact.address && (
          <View className="flex-row items-start" style={{ gap: 10 }}>
            <SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={16} tintColor={colors.muted} />
            <Text className="type-body text-ink min-w-0 flex-1">{`${gym.contact.address}, ${gym.area}, ${gym.city}`}</Text>
          </View>
        )}
        {gym.contact.phone && (
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <SymbolView name={{ ios: "phone", android: "call", web: "call" }} size={16} tintColor={colors.muted} />
            <Text className="type-body text-ink">{`+91 ${gym.contact.phone}`}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
