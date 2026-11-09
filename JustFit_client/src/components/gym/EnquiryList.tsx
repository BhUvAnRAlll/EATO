import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Platform, RefreshControl, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { EnquiryContactSheet } from "@/components/gym/EnquiryContactSheet";
import { EnquirySheet } from "@/components/gym/EnquirySheet";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { WhatsAppMark } from "@/components/gym/WhatsAppMark";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { ENQUIRY_STATUS_LABEL, ENQUIRY_VIEWS, INTEREST_LABEL, LEAD_LABEL, SOURCE_LABEL, contactText, followUpText, initialsOf, phoneText, referrerText, shortDate } from "@/data/gymDashboard";
import { gymApi, type EnquiryStatus, type EnquiryView, type GymEnquiry, type LeadLevel } from "@/lib/gymApi";
import { callPhone, enquiryFollowUp, whatsappPhone } from "@/lib/gymContact";
import { useReminderTemplates } from "@/lib/useReminderTemplates";
import { notice } from "@/lib/gymPortal";
import { haptic } from "@/lib/haptics";
import { listPerf } from "@/lib/listPerf";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

const EMPTY: Record<EnquiryView, { title: string; text: string }> = {
  today: { title: "No calls for today", text: "Enquiries to follow up today show here." },
  overdue: { title: "Nothing overdue", text: "Enquiries whose follow-up day has passed show here." },
  open: { title: "No open enquiries", text: "When someone asks about joining, tap + to add them so you can follow up." },
  joined: { title: "No one has joined yet", text: "Convert an enquiry to a member and it shows here." },
  lost: { title: "No one said no", text: "Enquiries marked not interested show here." },
  all: { title: "No enquiries yet", text: "When someone asks about joining, tap + to add them so you can follow up." },
};

// Manage › Enquiry: everyone who asked about joining, followed up until they join or say no.
// Lists (Today, Overdue, Open, Joined, Not interested, All) with their counts, search by name or
// number; each card shows when to call them back, what they want and how they found the gym, its
// Hot / Warm / Cold score with the reasons (Predictions #3; Open is sorted hottest first by the
// server), with Call, WhatsApp (the phone's own apps, the message written), a log button for a
// contact attempt and ⋯ to edit, change the status or Convert to member. After Call, when the app
// comes back to the front, "How did it go?" asks once (Reached / No answer / Skip). The round + adds one.
export function EnquiryList({ initialView = "open" }: { initialView?: EnquiryView }) {
  const colors = useThemeColors();
  // Role & Permission: Enquiries › Add and edit enquiries, and Log calls and visits
  const can = useCan();
  const canEdit = can("enquiries.edit");
  const canLog = can("enquiries.contacts");
  const getToken = useSessionToken();
  // Narrow phones (under 360): no initials circle, so the name and the follow-up line fit
  const narrow = useWindowDimensions().width < 360;
  const [view, setView] = useState<EnquiryView>(initialView);
  const [searchOpen, setSearchOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  // null: closed; "new": Add Enquiry; an enquiry: edit it
  const [editing, setEditing] = useState<GymEnquiry | "new" | null>(null);
  const [converting, setConverting] = useState<GymEnquiry | null>(null);
  // Logging a contact: from the card's button, or asked after a call
  const [logging, setLogging] = useState<{ enquiry: GymEnquiry; afterCall: boolean } | null>(null);
  const pendingCall = useRef<GymEnquiry | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  // Back from the phone app after Call: ask how it went (once per call)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !pendingCall.current) return;
      const enquiry = pendingCall.current;
      pendingCall.current = null;
      setLogging({ enquiry, afterCall: true });
    });
    return () => sub.remove();
  }, []);
  const call = (enquiry: GymEnquiry) => {
    // "How did it go?" only for a login that may log contacts
    pendingCall.current = canLog ? enquiry : null;
    callPhone(enquiry.phone);
  };

  const load = useCallback((token: string | null) => gymApi.enquiries(token, view, search), [view, search]);
  const { result, retry, reload, refreshing, refresh } = useGymData(load);
  // The branch's own follow-up wording (Reminder Templates) for the cards' WhatsApp
  const templates = useReminderTemplates();
  const data = result.state === "ready" ? result.data : null;

  const leadTone = (level: LeadLevel) =>
    level === "hot"
      ? { bg: colors.gymSuccessSoft, line: colors.gymSuccessLine, ink: colors.gymSuccess }
      : level === "warm"
        ? { bg: colors.gymWarningSoft, line: colors.gymWarningLine, ink: colors.gymWarning }
        : { bg: colors.gymBar, line: colors.gymLine, ink: colors.gymMuted };

  // Saved in Add Member: mark the enquiry joined and link the member, then open them
  const joined = async (enquiry: GymEnquiry, memberId: number) => {
    setConverting(null);
    const linked = await gymApi.editEnquiry(await getToken().catch(() => null), enquiry.id, { status: "joined", memberId });
    if (!linked.ok) notice("Member added", `${enquiry.name} was added as a member, but the enquiry couldn't be marked joined: ${linked.error}`);
    reload();
    router.push({ pathname: "/gym/members/[id]", params: { id: String(memberId) } });
  };

  const statusTone = (status: EnquiryStatus) =>
    status === "joined"
      ? { bg: colors.gymSuccessSoft, line: colors.gymSuccessLine, ink: colors.gymSuccess }
      : status === "lost"
        ? { bg: colors.gymBar, line: colors.gymLine, ink: colors.gymMuted }
        : { bg: colors.gymPrimarySoft, line: colors.gymPrimaryLine, ink: colors.gymPrimaryText };

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {ENQUIRY_VIEWS.map((v) => {
            const selected = v.id === view;
            const count = data?.counts[v.id];
            return (
              <PressableScale
                key={v.id}
                onPress={() => { if (!selected) haptic.select(); setView(v.id); }}
                className={selected ? "gym-kind gym-kind--selected" : "gym-kind"}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${v.label}${count !== undefined ? `, ${count}` : ""}`}
              >
                {selected && <GradientFill radius={999} />}
                <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{count !== undefined ? `${v.label} · ${count}` : v.label}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
        <PressableScale onPress={() => { setSearchOpen((o) => !o); if (searchOpen) setTyped(""); }} hitSlop={8} className="gym-plain-btn" accessibilityRole="button" accessibilityLabel={searchOpen ? "Close search" : "Search enquiries"}>
          <GymIcon name={searchOpen ? "x" : "search"} size={22} color={colors.gymInkSoft} />
        </PressableScale>
      </View>
      {searchOpen && (
        <View className="gym-field__input flex-row items-center" style={{ gap: 8 }}>
          <GymIcon name="search" size={16} color={colors.gymFaint} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Search by name or phone"
            placeholderTextColor={colors.gymFaint}
            autoFocus
            autoCorrect={false}
            maxLength={60}
            style={{ flex: 1, fontFamily: "Poppins-Regular", fontSize: 15, color: colors.gymInk, paddingVertical: 0 }}
            accessibilityLabel="Search enquiries"
          />
        </View>
      )}
    </View>
  );

  return (
    <>
      <FlatList
        {...listPerf}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}
        data={data?.enquiries ?? []}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        ListHeaderComponent={header}
        ListEmptyComponent={
          result.state === "loading" ? (
            <GymLoading label="Loading enquiries" />
          ) : result.state === "failed" ? (
            <GymError error={result.error} onRetry={retry} />
          ) : search ? (
            <GymEmpty icon="message-circle-question" title="No enquiries match" text="Try another name or number." />
          ) : (
            <GymEmpty icon="message-circle-question" title={EMPTY[view].title} text={EMPTY[view].text} />
          )
        }
        renderItem={({ item }) => {
          const open = item.status === "new" || item.status === "follow_up";
          const follow = open && item.followUpOn && data ? followUpText(item.followUpOn, data.today) : null;
          const followColor = follow?.tone === "overdue" ? colors.gymDanger : follow?.tone === "today" ? colors.gymWarning : colors.gymInkSoft;
          const about = [item.interest ? INTEREST_LABEL[item.interest] : null, item.source ? SOURCE_LABEL[item.source] : null].filter(Boolean).join(" · ");
          const referrer = referrerText(item.referredBy);
          const tone = statusTone(item.status);
          const lead = item.lead ? { ...leadTone(item.lead.level), text: `${LEAD_LABEL[item.lead.level]} · ${item.lead.score}`, reasons: item.lead.reasons.map((r) => r.text).join(" · ") } : null;
          const lastContact = item.contacts.length > 0 ? item.contacts[item.contacts.length - 1] : null;
          return (
            // The info opens the enquiry; Call, WhatsApp and the log button sit beside it (no button inside a button)
            <View className="gym-member-card">
              <PressableScale
                onPress={canEdit ? () => setEditing(item) : undefined}
                disabled={!canEdit}
                className="min-w-0 flex-1 flex-row items-center"
                style={{ gap: 12 }}
                accessibilityRole={canEdit ? "button" : "text"}
                accessibilityLabel={`${item.name}, ${ENQUIRY_STATUS_LABEL[item.status]}${lead ? `, ${lead.text}` : ""}${follow ? `, ${follow.text}` : ""}${about ? `, ${about}` : ""}${referrer ? `, ${referrer}` : ""}${item.member ? `, joined as ${item.member.code}` : ""}${canEdit ? ". Edit" : ""}`}
              >
                {!narrow && (
                  <View className="gym-avatar">
                    <Text className="gym-avatar__label">{initialsOf(item.name)}</Text>
                  </View>
                )}
                <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                  <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
                    <Text className="gym-member-card__name flex-shrink" numberOfLines={1}>{item.name}</Text>
                    <View className="gym-chip" style={{ borderColor: tone.line, backgroundColor: tone.bg }}>
                      <Text className="gym-chip__label" style={{ color: tone.ink }}>{ENQUIRY_STATUS_LABEL[item.status]}</Text>
                    </View>
                    {lead && (
                      <View className="gym-chip" style={{ borderColor: lead.line, backgroundColor: lead.bg }}>
                        <Text className="gym-chip__label" style={{ color: lead.ink }}>{lead.text}</Text>
                      </View>
                    )}
                  </View>
                  {lead?.reasons ? <Text className="gym-member-card__line" numberOfLines={2}>{lead.reasons}</Text> : null}
                  {item.phone ? <Text className="gym-member-card__line" numberOfLines={1}>{phoneText(item.phone)}</Text> : null}
                  {follow ? (
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <GymIcon name="calendar-clock" size={15} color={followColor} />
                      <Text className="gym-member-card__line" numberOfLines={1} style={{ color: followColor }}>{follow.text}</Text>
                    </View>
                  ) : null}
                  {item.member ? <Text className="gym-member-card__line" numberOfLines={1} style={{ color: colors.gymSuccess }}>{`Joined as ${item.member.code}`}</Text> : null}
                  {about ? <Text className="gym-tx__meta" numberOfLines={1}>{about}</Text> : null}
                  {referrer ? <Text className="gym-tx__meta" numberOfLines={2}>{referrer}</Text> : null}
                  {item.note ? <Text className="gym-tx__meta" numberOfLines={2}>{item.note}</Text> : null}
                  <Text className="gym-tx__meta" numberOfLines={1}>{`Asked on ${shortDate(item.enquiredOn)}`}</Text>
                  {lastContact ? <Text className="gym-tx__meta" numberOfLines={2}>{`Last contact: ${contactText(lastContact)}`}</Text> : null}
                </View>
              </PressableScale>
              {(item.phone || open) && (
                <View className="flex-row items-center" style={{ gap: 2 }}>
                  {item.phone && (
                    <PressableScale onPress={() => call(item)} hitSlop={6} className="gym-member-card__action" accessibilityRole="button" accessibilityLabel={`Call ${item.name}`}>
                      <GymIcon name="phone" size={20} color={colors.gymInkSoft} />
                    </PressableScale>
                  )}
                  {item.phone && (
                    <PressableScale onPress={() => data && whatsappPhone(item.phone, enquiryFollowUp(item.name, data.gym, templates?.templates))} hitSlop={6} className="gym-member-card__action" accessibilityRole="button" accessibilityLabel={`WhatsApp ${item.name}`}>
                      <WhatsAppMark size={22} />
                    </PressableScale>
                  )}
                  {open && canLog && (
                    <PressableScale onPress={() => setLogging({ enquiry: item, afterCall: false })} hitSlop={6} className="gym-member-card__action" accessibilityRole="button" accessibilityLabel={`Log a contact with ${item.name}`}>
                      <GymIcon name="clipboard-list" size={20} color={colors.gymInkSoft} />
                    </PressableScale>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
      {canEdit && <View className="absolute" style={{ right: 16, bottom: 16 }}>
        <PressableScale onPress={() => setEditing("new")} haptic="tap" className="gym-fab-round" accessibilityRole="button" accessibilityLabel="Add an enquiry">
          <GradientFill radius={26} />
          <GymIcon name="plus" size={22} color={colors.white} />
        </PressableScale>
      </View>}
      {editing && (
        <EnquirySheet
          enquiry={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
          onConvert={(enquiry) => { setEditing(null); setConverting(enquiry); }}
          onOpenMember={(id) => { setEditing(null); router.push({ pathname: "/gym/members/[id]", params: { id: String(id) } }); }}
        />
      )}
      {converting && (
        <AddMemberSheet
          initial={{ name: converting.name, phone: converting.phone }}
          onClose={() => setConverting(null)}
          onSaved={(detail) => joined(converting, detail.member.id)}
        />
      )}
      {logging && (
        <EnquiryContactSheet
          enquiry={logging.enquiry}
          afterCall={logging.afterCall}
          onClose={() => setLogging(null)}
          onSaved={() => { setLogging(null); haptic.success(); reload(); }}
        />
      )}
    </>
  );
}
