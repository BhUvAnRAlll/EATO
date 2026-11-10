import { useState, type ComponentProps, type ReactElement } from "react";
import { Linking, ScrollView, Text, useWindowDimensions, View, type RefreshControlProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import type { JoinPick } from "@/components/gymHub/JoinSheet";
import { openTrial, trialStateText } from "@/lib/gymTrial";
import { ReviewCard, ReviewSummaryCard, Stars } from "@/components/gymHub/ReviewParts";
import type { GymPage } from "@/lib/discoverApi";
import { directionsUrl, facilityLabel, indiaNow, joinStateText, openNow, perMonthText, planLengthText, priceText } from "@/lib/gymDiscover";
import { countText, hideReasonText } from "@/lib/gymReviews";
import { closureDateText, DAYS, dayText, gymTypesText, stampText, timeLabel, yearsText } from "@/lib/gymProfile";
import { hud } from "@/lib/hud";
import { useThemeColors } from "@/theme";

// A gym's page as members see it (Gym Hub phase 3; Gym Profile Management, 2026-11-09): its photos,
// name and logo, open now, Call / WhatsApp / Directions (the phone's own apps), about, facilities
// (the list's and the gym's own), the week's hours and closures, the plans to compare, PT packages,
// the address, contacts and links. Sections the gym switched off arrive empty and are left out.
// Members get Ask buttons (onAsk), their standing (gym.you) and their review (onReview); the gym's
// own preview gets none of them. at: when the page was read (open now and today follow it).
export function GymPageView({ gym, at, onAsk, onTrial, onCancelTrial, onReview, refreshControl }: { gym: GymPage; at: number; onAsk?: (pick: JoinPick) => void; onTrial?: () => void; onCancelTrial?: () => void; onReview?: () => void; refreshControl?: ReactElement<RefreshControlProps> }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom, gap: 16 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
      <Photos gym={gym} />
      <Identity gym={gym} at={at} />
      {gymTypesText(gym.types) ? <Text className="type-caption text-primary-text" accessibilityLabel={`Kind of gym: ${gymTypesText(gym.types)}`}>{gymTypesText(gym.types)}</Text> : null}
      {gym.about ? <Text className="type-body text-ink">{gym.about}</Text> : null}
      <Facilities gym={gym} />
      <Hours gym={gym} at={at} />
      <Standing gym={gym} onCancelTrial={onCancelTrial} />
      <Plans gym={gym} onAsk={onAsk} onTrial={onTrial} />
      <Trainers gym={gym} />
      <Reviews gym={gym} onReview={onReview} />
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
          <View key={p.id} style={{ width: tile, gap: 4 }} accessible accessibilityLabel={`Photo ${i + 1} of ${gym.photos.length}${p.facility ? `: ${facilityLabel(p.facility)}` : ""}`}>
            <View className="hub-gym-photo" style={{ width: tile }}>
              <MemberPhotoImage url={p.url} />
            </View>
            {p.facility ? <Text className="type-caption text-ink">{facilityLabel(p.facility)}</Text> : null}
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
function Standing({ gym, onCancelTrial }: { gym: GymPage; onCancelTrial?: () => void }) {
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
  // A free trial: where it stands and when it's booked, with Cancel while it's open
  if (request.trial) {
    const t = trialStateText(request.trial, gym.name);
    return (
      <View className="card" style={{ gap: 8 }}>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }} accessible accessibilityLabel={`Your free trial: ${t.label}. ${t.line}`}>
          <Text className="card__title">Your free trial</Text>
          <View className={`badge badge--${t.tone}`}><Text className={`badge__label badge__label--${t.tone}`}>{t.label}</Text></View>
        </View>
        {request.trial.at ? (
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <SymbolView name={{ ios: "calendar", android: "calendar_today", web: "calendar_today" }} size={16} tintColor={colors.leaf} />
            <Text className="type-subhead text-ink">{request.trial.at.text}</Text>
          </View>
        ) : null}
        <Text className="type-body text-ink">{t.line}</Text>
        {onCancelTrial && openTrial(request.trial) && (
          <PressableScale onPress={onCancelTrial} className="self-start" hitSlop={8} accessibilityRole="button">
            <Text className="auth__note-link">Cancel trial</Text>
          </PressableScale>
        )}
      </View>
    );
  }
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
function Plans({ gym, onAsk, onTrial }: { gym: GymPage; onAsk?: (pick: JoinPick) => void; onTrial?: () => void }) {
  const colors = useThemeColors();
  // Plans can be asked about by anyone not a member here; PT by members too. The preview asks nothing.
  const canAskPlan = Boolean(onAsk && gym.you) && gym.you!.memberId === null && !asking(gym);
  const canAskPt = Boolean(onAsk && gym.you) && !asking(gym);
  // The gym's own Best value when it marked one, else the cheapest a month
  const marked = gym.plans.find((p) => p.bestValue);
  const cheapest = gym.plans.length > 1 ? Math.min(...gym.plans.map((p) => p.perMonth ?? Infinity)) : null;
  const isBestPlan = (p: GymPage["plans"][number]) => (marked ? p.id === marked.id : cheapest !== null && p.perMonth === cheapest);
  if (gym.plans.length === 0 && gym.pt.length === 0 && !canAskPlan) return null;
  return (
    <View style={{ gap: 10 }}>
      {gym.plans.length > 0 && <Text className="type-headline text-ink" accessibilityRole="header">Membership plans</Text>}
      {gym.plans.length > 1 && <Text className="type-caption text-muted">Compare the price a month: longer plans usually cost less.</Text>}
      {gym.plans.map((p) => {
        const isBest = isBestPlan(p);
        return (
          <View key={p.id} className={isBest ? "hub-plan hub-plan--best" : "hub-plan"} accessible accessibilityLabel={`${p.name}, ${planLengthText(p.months, p.days)}, ${priceText(p.price)}, ${perMonthText(p.perMonth)}${p.savesPerMonth ? `, saves ${priceText(p.savesPerMonth)} a month` : ""}${isBest ? ", best value" : ""}${p.details ? `. ${p.details}` : ""}${p.benefits?.length ? `. Includes: ${p.benefits.join(", ")}` : ""}`}>
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
            <Benefits list={p.benefits} />
            <PlanTerms eligibility={p.eligibility} terms={p.terms} />
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
              <Benefits list={p.benefits} />
              <PlanTerms eligibility={p.eligibility} terms={p.terms} />
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
      {canAskPlan && onTrial && (
        <PressableScale onPress={onTrial} className="coach__ghost" haptic="tap" accessibilityRole="button" accessibilityLabel="Book a free trial">
          <Text className="coach__ghost-label">Book a free trial</Text>
        </PressableScale>
      )}
      {(gym.plans.length > 0 || gym.pt.length > 0 || canAskPlan) && (
        <Text className="type-caption text-muted">{canAskPlan ? "The gym calls you to help you join. You pay the gym, not the app." : "Prices are set by the gym. You pay the gym, not the app."}</Text>
      )}
    </View>
  );
}

// The gym's trainers (Gym Profile phase 3): a card each with the photo (or initials), name,
// experience and specialisations; More shows the bio, certifications and when they're available
function Trainers({ gym }: { gym: GymPage }) {
  if (!gym.trainers || gym.trainers.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Trainers</Text>
      {gym.trainers.map((t) => <TrainerCard key={t.id} trainer={t} />)}
    </View>
  );
}

function TrainerCard({ trainer: t }: { trainer: NonNullable<GymPage["trainers"]>[number] }) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const initials = t.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const more = Boolean(t.bio || t.certifications.length || t.availability);
  return (
    <View className="card" style={{ gap: 10 }}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, overflow: "hidden", backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" }} accessible accessibilityLabel={t.photoUrl ? `Photo of ${t.name}` : undefined}>
          {t.photoUrl ? <MemberPhotoImage url={t.photoUrl} /> : <Text className="type-subhead text-primary-text">{initials}</Text>}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="card__title" numberOfLines={1}>{t.name}</Text>
          {t.years !== null ? <Text className="card__subtitle">{yearsText(t.years)}</Text> : null}
        </View>
      </View>
      {t.specializations.length > 0 && (
        <View className="flex-row flex-wrap" style={{ gap: 6 }}>
          {t.specializations.map((s) => (
            <View key={s} className="address-tag"><Text className="address-tag__label">{s}</Text></View>
          ))}
        </View>
      )}
      {open && (
        <View style={{ gap: 8 }}>
          {t.bio ? <Text className="type-body text-ink">{t.bio}</Text> : null}
          <Benefits list={t.certifications} />
          {t.availability && (
            <View style={{ gap: 2 }}>
              <Text className="type-caption text-muted">Available</Text>
              {DAYS.filter((d) => t.availability![d.id].length > 0).map((d) => (
                <Text key={d.id} className="type-caption text-ink">{`${d.short}: ${dayText(t.availability![d.id])}`}</Text>
              ))}
            </View>
          )}
        </View>
      )}
      {more && (
        <PressableScale onPress={() => setOpen((o) => !o)} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? `Less about ${t.name}` : `More about ${t.name}`}>
          <Text className="auth__note-link">{open ? "Less" : "More about them"}</Text>
        </PressableScale>
      )}
    </View>
  );
}

// Members' reviews (Gym Profile phase 4): the summary, the member's own (or Write a review when
// they are or were a member here), the newest few and See all. Absent before the server's migration.
function Reviews({ gym, onReview }: { gym: GymPage; onReview?: () => void }) {
  const colors = useThemeColors();
  const r = gym.reviews;
  if (!r) return null;
  const mine = onReview ? r.mine : null;
  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Reviews</Text>
      <ReviewSummaryCard summary={r.summary} />
      {mine ? (
        <PressableScale onPress={onReview} className="card" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`Your review: ${mine.rating} stars. Edit`}>
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Text className="card__title">Your review</Text>
            <Text className="auth__note-link">Edit</Text>
          </View>
          <Stars rating={mine.rating} />
          {mine.comment ? <Text className="type-body text-ink" numberOfLines={3}>{mine.comment}</Text> : null}
          {mine.hiddenReason ? <Text className="type-caption" style={{ color: colors.warning }}>{`The gym hid your words: ${hideReasonText(mine.hiddenReason).toLowerCase()}. Your stars still count.`}</Text> : null}
        </PressableScale>
      ) : onReview && r.canReview ? (
        <PrimaryButton label="Write a review" onPress={onReview} />
      ) : null}
      {r.reviews.filter((x) => !(onReview && x.isYou)).map((x) => <ReviewCard key={x.id} review={x} />)}
      {onReview && r.summary.count > r.reviews.length && (
        <PressableScale onPress={() => router.push({ pathname: "/gym-hub/reviews/[id]", params: { id: String(gym.id) } })} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityLabel={`See all ${countText(r.summary.count)}`}>
          <Text className="auth__note-link">{`See all ${countText(r.summary.count)}`}</Text>
        </PressableScale>
      )}
    </View>
  );
}

// What a plan includes, a tick a line (Gym Profile phase 2)
// Who may buy a plan, always shown, and its terms behind a tap (G17)
function PlanTerms({ eligibility, terms }: { eligibility?: string | null; terms?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!eligibility && !terms) return null;
  return (
    <View style={{ gap: 4 }}>
      {eligibility ? <Text className="type-caption text-ink">{`Who can join: ${eligibility}`}</Text> : null}
      {terms ? (
        <>
          <PressableScale onPress={() => setOpen((o) => !o)} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? "Hide the terms" : "Show the terms"}>
            <Text className="auth__note-link">{open ? "Hide terms" : "Terms"}</Text>
          </PressableScale>
          {open ? <Text className="type-caption text-muted">{terms}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function Benefits({ list }: { list?: string[] }) {
  const colors = useThemeColors();
  if (!list || list.length === 0) return null;
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`Includes: ${list.join(", ")}`}>
      {list.map((b) => (
        <View key={b} className="flex-row items-start" style={{ gap: 6 }}>
          <SymbolView name={icon("checkmark", "check")} size={12} tintColor={colors.success} />
          <Text className="type-caption text-ink min-w-0 flex-1">{b}</Text>
        </View>
      ))}
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
