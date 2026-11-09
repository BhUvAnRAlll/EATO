import { useState, type ComponentProps, type ReactElement } from "react";
import { Linking, ScrollView, Text, useWindowDimensions, View, type RefreshControlProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import type { JoinPick } from "@/components/gymHub/JoinSheet";
import type { GymPage } from "@/lib/discoverApi";
import { directionsUrl, facilityLabel, indiaNow, joinStateText, openNow, perMonthText, planLengthText, priceText } from "@/lib/gymDiscover";
import { closureDateText, DAYS, dayText, stampText, timeLabel } from "@/lib/gymProfile";
import { hud } from "@/lib/hud";
import { useThemeColors } from "@/theme";

// A gym's page as members see it (Gym Hub phase 3; Gym Profile Management, 2026-11-09): its photos,
// name and logo, open now, Call / WhatsApp / Directions (the phone's own apps), about, facilities
// (the list's and the gym's own), the week's hours and closures, the plans to compare, PT packages,
// the address, contacts and links. Sections the gym switched off arrive empty and are left out.
// Members get Ask buttons (onAsk) and their standing (gym.you); the gym's own preview gets neither.
// at: when the page was read (open now and today follow it).
export function GymPageView({ gym, at, onAsk, refreshControl }: { gym: GymPage; at: number; onAsk?: (pick: JoinPick) => void; refreshControl?: ReactElement<RefreshControlProps> }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom, gap: 16 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
      <Photos gym={gym} />
      <Identity gym={gym} at={at} />
      {gym.about ? <Text className="type-body text-ink">{gym.about}</Text> : null}
      <Facilities gym={gym} />
      <Hours gym={gym} at={at} />
      <Standing gym={gym} />
      <Plans gym={gym} onAsk={onAsk} />
      <Place gym={gym} />
      {gym.updatedAt ? <Text className="type-caption text-muted text-center">{`Updated by the gym · ${stampText(gym.updatedAt, at)}`}</Text> : null}
    </ScrollView>
  );
}

type Icon = ComponentProps<typeof SymbolView>["name"];
const icon = (ios: string, android: string) => ({ ios, android, web: android }) as Icon;
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

function Identity({ gym, at }: { gym: GymPage; at: number }) {
  const colors = useThemeColors();
  const now = openNow(gym.hours, at);
  const closedToday = gym.closures.find((c) => c.date === new Date(at + 330 * 60000).toISOString().slice(0, 10));
  const chip = (label: string, ios: string, android: string, onPress: () => void, a11y: string) => (
    <PressableScale key={label} onPress={onPress} className="admin-chip flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={a11y}>
      <SymbolView name={icon(ios, android)} size={14} tintColor={colors.leaf} />
      <Text className="admin-segment__label admin-segment__label--on">{label}</Text>
    </PressableScale>
  );
  const canDirect = gym.location !== null || gym.contact.address !== null;
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
      {closedToday ? (
        <View className="badge badge--paused self-start">
          <Text className="badge__label badge__label--paused">{closedToday.note ? `Closed today · ${closedToday.note}` : "Closed today"}</Text>
        </View>
      ) : now ? (
        <View className={`badge badge--${now.open ? "active" : "paused"} self-start`}>
          <Text className={`badge__label badge__label--${now.open ? "active" : "paused"}`}>{now.line}</Text>
        </View>
      ) : null}
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {gym.contact.phone && chip("Call", "phone", "call", () => open(`tel:+91${gym.contact.phone}`, "Couldn't open the phone app"), `Call ${gym.name}`)}
        {gym.contact.whatsapp && chip("WhatsApp", "message", "chat", () => open(`https://wa.me/91${gym.contact.whatsapp}`, "Couldn't open WhatsApp"), `WhatsApp ${gym.name}`)}
        {canDirect && chip("Directions", "mappin.and.ellipse", "directions", () => open(directionsUrl(gym), "Couldn't open maps"), `Directions to ${gym.name}`)}
      </View>
    </View>
  );
}

function Facilities({ gym }: { gym: GymPage }) {
  const names = [...gym.facilities.map(facilityLabel), ...gym.customFacilities];
  if (names.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Facilities</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {names.map((name) => (
          <View key={name} className="address-tag">
            <Text className="address-tag__label">{name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Hours({ gym, at }: { gym: GymPage; at: number }) {
  const colors = useThemeColors();
  if (!gym.hours && gym.closures.length === 0) return null;
  const today = indiaNow(at).day;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Opening hours</Text>
      {gym.hours && (
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
      )}
      {gym.closures.length > 0 && (
        <View className="card" style={{ gap: 8 }}>
          <Text className="card__title">Closed on</Text>
          {gym.closures.map((c) => (
            <View key={c.date} className="flex-row justify-between" style={{ gap: 12 }} accessible accessibilityLabel={`Closed on ${closureDateText(c.date)}${c.note ? `, ${c.note}` : ""}`}>
              <Text className="type-body text-ink">{closureDateText(c.date)}</Text>
              {c.note ? <Text className="type-body text-muted min-w-0 flex-1" style={{ textAlign: "right" }} numberOfLines={2}>{c.note}</Text> : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// Whether a request can be sent now: not while one is waiting (the server refuses it too)
export const asking = (gym: GymPage) => gym.you?.request != null && (gym.you.request.state === "sent" || gym.you.request.state === "in_touch");

// Already a member here (a link to the membership), or the request waiting with the gym
function Standing({ gym }: { gym: GymPage }) {
  const colors = useThemeColors();
  if (!gym.you) return null;
  if (gym.you.memberId !== null) {
    return (
      <PressableScale onPress={() => router.push({ pathname: "/gym-hub/[id]", params: { id: String(gym.you!.memberId) } })} className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel={`You're a member at ${gym.name}. Open your membership`}>
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
function Plans({ gym, onAsk }: { gym: GymPage; onAsk?: (pick: JoinPick) => void }) {
  const colors = useThemeColors();
  // Plans can be asked about by anyone not a member here; PT by members too. The preview asks nothing.
  const canAskPlan = Boolean(onAsk && gym.you) && gym.you!.memberId === null && !asking(gym);
  const canAskPt = Boolean(onAsk && gym.you) && !asking(gym);
  const best = gym.plans.length > 1 ? Math.min(...gym.plans.map((p) => p.perMonth ?? Infinity)) : null;
  if (gym.plans.length === 0 && gym.pt.length === 0 && !canAskPlan) return null;
  return (
    <View style={{ gap: 10 }}>
      {gym.plans.length > 0 && <Text className="type-headline text-ink" accessibilityRole="header">Membership plans</Text>}
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
              <PressableScale onPress={() => onAsk!({ itemId: p.id, label: `${p.name} · ${planLengthText(p.months, p.days)} · ${priceText(p.price)}` })} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Ask about ${p.name}`}>
                <Text className="auth__note-link">Ask about this plan</Text>
              </PressableScale>
            )}
          </View>
        );
      })}
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
                <PressableScale onPress={() => onAsk!({ itemId: p.id, label: `PT · ${p.name} · ${priceText(p.price)}` })} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Ask about ${p.name}`}>
                  <Text className="auth__note-link">Ask about this package</Text>
                </PressableScale>
              )}
            </View>
          ))}
        </View>
      )}
      {canAskPlan && <PrimaryButton label="Ask to join" onPress={() => onAsk!({ itemId: null, label: null })} />}
      {(gym.plans.length > 0 || gym.pt.length > 0 || canAskPlan) && (
        <Text className="type-caption text-muted">{canAskPlan ? "The gym calls you to help you join. You pay the gym, not the app." : "Prices are set by the gym. You pay the gym, not the app."}</Text>
      )}
    </View>
  );
}

function Place({ gym }: { gym: GymPage }) {
  const colors = useThemeColors();
  const c = gym.contact;
  const links: { label: string; url: string; ios: string; android: string }[] = [
    ...(c.website ? [{ label: "Website", url: c.website, ios: "globe", android: "language" }] : []),
    ...(c.instagram ? [{ label: "Instagram", url: c.instagram, ios: "camera", android: "photo_camera" }] : []),
    ...(c.facebook ? [{ label: "Facebook", url: c.facebook, ios: "person.2", android: "group" }] : []),
  ];
  if (!c.address && !c.phone && !c.whatsapp && !c.email && links.length === 0) return null;
  const line = (ios: string, android: string, text: string, onPress?: () => void, a11y?: string) => {
    const body = (
      <>
        <SymbolView name={icon(ios, android)} size={16} tintColor={onPress ? colors.leaf : colors.muted} />
        <Text className={onPress ? "type-body text-primary-text min-w-0 flex-1" : "type-body text-ink min-w-0 flex-1"}>{text}</Text>
      </>
    );
    return onPress ? (
      <PressableScale key={text} onPress={onPress} className="flex-row items-start" style={{ gap: 10 }} accessibilityRole="link" accessibilityLabel={a11y ?? text}>{body}</PressableScale>
    ) : (
      <View key={text} className="flex-row items-start" style={{ gap: 10 }}>{body}</View>
    );
  };
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Address and contact</Text>
      <View className="card" style={{ gap: 10 }}>
        {c.address && line("mappin.and.ellipse", "location_on", `${c.address}, ${gym.area}, ${gym.city}`)}
        {c.phone && line("phone", "call", `+91 ${c.phone}`)}
        {c.whatsapp && c.whatsapp !== c.phone && line("message", "chat", `WhatsApp +91 ${c.whatsapp}`)}
        {c.email && line("envelope", "mail", c.email, () => open(`mailto:${c.email}`, "Couldn't open email"), `Email ${c.email}`)}
        {links.map((l) => line(l.ios, l.android, l.label, () => open(l.url, "Couldn't open the link"), `Open ${gym.name}'s ${l.label}`))}
      </View>
    </View>
  );
}
