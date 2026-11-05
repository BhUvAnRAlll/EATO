import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import type { GymIconName } from "@/constants/gymIcons";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberActionsSheet } from "@/components/gym/MemberActionsSheet";
import { MEMBER_FILTERS, rupees } from "@/data/gymDashboard";
import { gymApi, type GymInfo, type GymMember, type MemberFilter, type SmsKind } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { SMS_KIND_LABEL, membershipKind, textFromPhone } from "@/lib/gymSms";
import { listPerf } from "@/lib/listPerf";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

export const isMemberFilter = (value: unknown): value is MemberFilter => typeof value === "string" && MEMBER_FILTERS.some((f) => f.id === value);

export type MemberPick = "renewal" | "due" | "pt" | null;

type Sort = "name" | "days" | "due";
const SORTS: { id: Sort; label: string }[] = [
  { id: "name", label: "Name (A to Z)" },
  { id: "days", label: "Days left (fewest first)" },
  { id: "due", label: "Payment due (highest first)" },
];
const filterTitle = (id: MemberFilter) => (id === "all" ? "All Members" : MEMBER_FILTERS.find((f) => f.id === id)?.label ?? "All Members");

// "4 days left", "0 days left", or "Expired" (red) + "6 days ago"
function daysText(days: number) {
  if (days < 0) return { expired: true, text: `${-days} ${days === -1 ? "day" : "days"} ago` };
  return { expired: false, text: `${days} ${days === 1 ? "day" : "days"} left` };
}

// A reminder about to be sent: who, which message, and the branch's balance
type Pending = { member: GymMember; kind: SmsKind; credits: number };

// Manage › Member (the user's "Reminders from the list" design): a Member dropdown (the filters),
// sort and search; each card has the member's ID (PT when on personal training), days left or
// how long ago it expired, what they owe, a due reminder (when they owe), a membership reminder
// (red once expired) and ⋯ for their options. Reminders go by SMS from justFit (1 credit each,
// after a confirm); while sending is off the phone's own SMS app opens with the text written.
// In pick mode (from + › Renewal, Due payment or PT) tapping a member opens that form.
export function MemberList({ pick = null, initialFilter = "all", focusSearch = false }: { pick?: MemberPick; initialFilter?: MemberFilter; focusSearch?: boolean }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  // Narrow phones (under 360): no photo spot, no "Member" caption, tighter buttons
  const narrow = useWindowDimensions().width < 360;
  const [filter, setFilter] = useState<MemberFilter>(initialFilter);
  const [sort, setSort] = useState<Sort>("name");
  const [searchOpen, setSearchOpen] = useState(focusSearch);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<"filter" | "sort" | "add" | null>(null);
  const [actions, setActions] = useState<GymMember | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  // Search after a short pause in typing
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback((token: string | null) => gymApi.members(token, filter, search), [filter, search]);
  const { result, retry, reload } = useGymData(load);
  const gym: GymInfo | null = result.state === "ready" ? result.data.gym : null;

  const members = useMemo(() => {
    const list = result.state === "ready" ? [...result.data.members] : [];
    if (sort === "days") list.sort((a, b) => a.daysLeft - b.daysLeft);
    if (sort === "due") list.sort((a, b) => b.due - a.due);
    return list;
  }, [result, sort]);

  const open = (member: GymMember) => {
    const id = String(member.id);
    if (pick === "renewal") router.push({ pathname: "/gym/members/[id]/renew", params: { id } });
    else if (pick === "due") router.push({ pathname: "/gym/members/[id]/due", params: { id } });
    else if (pick === "pt") router.push({ pathname: "/gym/members/[id]/pt", params: { id } });
    else router.push({ pathname: "/gym/members/[id]", params: { id } });
  };

  const say = (title: string, text: string) => {
    if (Platform.OS === "web") globalThis.alert?.(`${title}\n\n${text}`);
    else Alert.alert(title, text);
  };

  // A reminder button: check sending and credits first, then confirm (or open the SMS app)
  const remind = async (member: GymMember, kind: SmsKind) => {
    if (!gym || busy) return;
    haptic.select();
    setBusy(member.id);
    const answer = await gymApi.sms(await getToken().catch(() => null));
    setBusy(null);
    if (!answer.ok || !answer.data.sending) return textFromPhone(member, gym, kind);
    if (answer.data.credits < 1) return say("No SMS credits left", "Ask the justFit team to add more credits to send reminders.");
    setPending({ member, kind, credits: answer.data.credits });
  };

  // A ref guard: a double tap on Send SMS in one frame would send (and pay for) it twice
  const sendingRef = useRef(false);
  const send = async () => {
    if (!pending || sendingRef.current) return;
    sendingRef.current = true;
    const { member, kind } = pending;
    setPending(null);
    setBusy(member.id);
    const answer = await gymApi.memberSms(await getToken().catch(() => null), member.id, kind);
    sendingRef.current = false;
    setBusy(null);
    if (answer.ok) {
      haptic.success();
      say("Reminder sent", `${SMS_KIND_LABEL[kind]} sent to ${member.name}. ${answer.data.credits} ${answer.data.credits === 1 ? "credit" : "credits"} left.`);
    } else say("Not sent", answer.error);
  };

  const iconBtn = (label: string, onPress: () => void, icon: GymIconName, tint: string, id: number) => (
    <PressableScale onPress={onPress} disabled={busy === id} hitSlop={6} className="gym-member-card__action" style={narrow ? { width: 28 } : undefined} accessibilityRole="button" accessibilityLabel={label}>
      <GymIcon name={icon} size={20} color={tint} />
    </PressableScale>
  );

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      {pick && <Text className="gym-tx__meta">{pick === "renewal" ? "Pick the member who is renewing." : pick === "pt" ? "Pick the member who is paying for personal training." : "Pick the member who is paying their due."}</Text>}
      <View className="flex-row items-center" style={{ gap: 10 }}>
        {!narrow && <Text className="gym-dropdown__caption">Member</Text>}
        <PressableScale onPress={() => setSheet("filter")} className="gym-dropdown flex-1" accessibilityRole="button" accessibilityLabel={`Show: ${filterTitle(filter)}. Change`}>
          <Text className="gym-dropdown__label flex-1" numberOfLines={1}>{filterTitle(filter)}</Text>
          <GymIcon name="chevron-down" size={18} color={colors.gymInk} />
        </PressableScale>
        <PressableScale onPress={() => setSheet("sort")} hitSlop={8} className="gym-plain-btn" accessibilityRole="button" accessibilityLabel={`Sort: ${SORTS.find((s) => s.id === sort)?.label}`}>
          <GymIcon name="list-filter" size={22} color={sort === "name" ? colors.gymInkSoft : colors.gymPrimary} />
        </PressableScale>
        <PressableScale onPress={() => { setSearchOpen((v) => !v); if (searchOpen) setTyped(""); }} hitSlop={8} className="gym-plain-btn" accessibilityRole="button" accessibilityLabel={searchOpen ? "Close search" : "Search members"}>
          <GymIcon name={searchOpen ? "x" : "search"} size={22} color={colors.gymInkSoft} />
        </PressableScale>
      </View>
      {searchOpen && (
        <View className="gym-field__input flex-row items-center" style={{ gap: 8 }}>
          <GymIcon name="search" size={16} color={colors.gymFaint} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Search by name, phone or ID"
            placeholderTextColor={colors.gymFaint}
            autoFocus
            autoCorrect={false}
            maxLength={60}
            style={{ flex: 1, fontFamily: "Poppins-Regular", fontSize: 15, color: colors.gymInk, paddingVertical: 0 }}
            accessibilityLabel="Search members"
          />
        </View>
      )}
    </View>
  );

  const choiceSheet = <T extends string>(title: string, options: { id: T; label: string }[], value: T, onPick: (id: T) => void) => (
    <GymSheet title={title} onClose={() => setSheet(null)}>
      <View>
        {options.map((o) => {
          const selected = o.id === value;
          return (
            <Pressable key={o.id} onPress={() => { haptic.select(); onPick(o.id); setSheet(null); }} className="gym-addrow" accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={o.label}>
              <Text className="gym-menu__label flex-1" numberOfLines={1} style={selected ? { color: colors.gymPrimaryText } : undefined}>{o.label}</Text>
              {selected && <GymIcon name="check" size={16} color={colors.gymPrimary} />}
            </Pressable>
          );
        })}
      </View>
    </GymSheet>
  );

  return (
    <>
      <FlatList
        {...listPerf}
        data={members}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        ListHeaderComponent={header}
        ListEmptyComponent={
          result.state === "loading" ? (
            <GymLoading label="Loading members" />
          ) : result.state === "failed" ? (
            <GymError error={result.error} onRetry={retry} />
          ) : (
            <GymEmpty icon="users" title={search || filter !== "all" ? "No members match" : "No members yet"} text={filter === "birthday" && !search ? "Add members' dates of birth to see their birthdays here." : search || filter !== "all" ? "Try another search or filter." : "Tap Add to record your first admission."} />
          )
        }
        renderItem={({ item }) => {
          const days = daysText(item.daysLeft);
          const kind = membershipKind(item);
          return (
            // The info opens the member; the reminder buttons sit beside it (no button inside a button)
            <View className="gym-member-card">
              <PressableScale
                onPress={() => open(item)}
                className="min-w-0 flex-1 flex-row items-center"
                style={{ gap: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.code}${item.pt?.active ? ", on PT" : ""}, ${days.expired ? `expired ${days.text}` : days.text}${item.due > 0 ? `, ${rupees(item.due)} payment due` : ""}`}
              >
                {!narrow && (
                  <View className="gym-member-card__avatar">
                    <GymIcon name="user" size={34} color={colors.white} />
                    <MemberPhotoImage url={item.photoUrl} />
                  </View>
                )}
                <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                  <Text className="gym-member-card__name" numberOfLines={1}>{item.name}</Text>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <GymIcon name="id-card" size={15} color={colors.gymInkSoft} />
                    <Text className="gym-member-card__line" numberOfLines={1}>{item.code}</Text>
                    {item.pt?.active && (
                      <View className="gym-chip" style={{ borderColor: colors.gymSuccessLine, backgroundColor: colors.gymSuccessSoft }}>
                        <Text className="gym-chip__label" style={{ color: colors.gymSuccess }}>PT</Text>
                      </View>
                    )}
                  </View>
                  <Text className="gym-member-card__line" numberOfLines={1}>
                    {days.expired ? <Text style={{ color: colors.gymDanger }}>{"Expired "}</Text> : null}
                    {days.text}
                  </Text>
                  {item.due > 0 && (
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <GymIcon name="banknote" size={16} color={colors.gymTileBlueIcon} />
                      <Text className="gym-member-card__line" numberOfLines={2} style={{ flexShrink: 1, color: item.overdue ? colors.gymDanger : undefined }}>{`${rupees(item.due)} payment due${item.overdue ? " · overdue" : ""}`}</Text>
                    </View>
                  )}
                </View>
              </PressableScale>
              {!pick && (
                <View className="flex-row items-center" style={{ gap: 2 }}>
                  {item.due > 0 && iconBtn(`Send ${item.name} a due reminder`, () => remind(item, "due"), "message-square-text", colors.gymInkSoft, item.id)}
                  {iconBtn(`Send ${item.name} ${kind === "expired" ? "an expired" : "an expiry"} reminder`, () => remind(item, kind), "message-square", kind === "expired" ? colors.gymDanger : colors.gymInkSoft, item.id)}
                  {iconBtn(`${item.name}: options`, () => setActions(item), "ellipsis", colors.gymInkSoft, -1)}
                </View>
              )}
            </View>
          );
        }}
      />
      {!pick && (
        <View className="absolute" style={{ right: 16, bottom: 16 }}>
          <PressableScale onPress={() => setSheet("add")} haptic="tap" className="gym-fab-round" accessibilityRole="button" accessibilityLabel="Add a member">
            <GradientFill radius={26} />
            <GymIcon name="plus" size={22} color={colors.white} />
          </PressableScale>
        </View>
      )}
      {sheet === "add" && (
        <AddMemberSheet
          onClose={() => setSheet(null)}
          onSaved={(detail) => {
            setSheet(null);
            reload();
            router.push({ pathname: "/gym/members/[id]", params: { id: String(detail.member.id) } });
          }}
        />
      )}
      {sheet === "filter" && choiceSheet("Show members", MEMBER_FILTERS.map((f) => ({ id: f.id, label: filterTitle(f.id) })), filter, setFilter)}
      {sheet === "sort" && choiceSheet("Sort members", SORTS, sort, setSort)}
      {actions && gym && <MemberActionsSheet member={actions} gym={gym} onClose={() => setActions(null)} onChanged={(detail) => { setActions(detail.member); reload(); }} />}
      {pending && (
        <Modal visible transparent animationType="none" onRequestClose={() => setPending(null)} statusBarTranslucent>
          <ConfirmDialog
            title={`Send ${SMS_KIND_LABEL[pending.kind].toLowerCase()}?`}
            rows={[["To", pending.member.name], ["Cost", "1 credit"], ["Credits left", String(pending.credits)]]}
            editLabel="Cancel"
            confirmLabel="Send SMS"
            onEdit={() => setPending(null)}
            onConfirm={send}
          />
        </Modal>
      )}
    </>
  );
}
