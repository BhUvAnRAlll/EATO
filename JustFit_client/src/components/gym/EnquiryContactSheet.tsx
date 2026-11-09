import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { WhatsAppMark } from "@/components/gym/WhatsAppMark";
import { GymSheet } from "@/components/gym/GymSheet";
import { CONTACT_NOTE_MAX, NEXT_FOLLOW_UP, SAID_NO_ANSWER, SAID_REACHED, daysFromToday, noteHas, shortDate, toggleSaid } from "@/data/gymDashboard";
import { gymApi, type ContactKind, type ContactOutcome, type GymEnquiry } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

type Option = { label: string; icon: GymIconName | "whatsapp"; kind: ContactKind; outcome?: ContactOutcome };
// After a call the phone comes back to the app: just how it went
const AFTER_CALL: Option[] = [
  { label: "Reached them", icon: "phone", kind: "call", outcome: "reached" },
  { label: "No answer", icon: "phone-off", kind: "call", outcome: "no_answer" },
];
// Logged by hand: a call, a WhatsApp message or a visit
const ANY: Option[] = [
  ...AFTER_CALL,
  { label: "Messaged on WhatsApp, they replied", icon: "whatsapp", kind: "whatsapp", outcome: "reached" },
  { label: "Messaged on WhatsApp, no reply", icon: "whatsapp", kind: "whatsapp", outcome: "no_answer" },
  { label: "They visited the gym", icon: "store", kind: "visit" },
];

// Manage › Enquiry: log a contact attempt with an enquiry (feeds the Hot / Warm / Cold score).
// Opens by itself after Call, when the app comes back to the front (with Skip), and from the
// card's log button. Two steps (2026-11-09, the user's request): how it went, then what they said
// (quick phrases or their own words) and when to follow up next, saved together, dated today.
export function EnquiryContactSheet({ enquiry, afterCall, onClose, onSaved }: { enquiry: GymEnquiry; afterCall: boolean; onClose: () => void; onSaved: (enquiry: GymEnquiry) => void }) {
  const colors = useThemeColors();
  const { busy, error, save } = useGymSave((data: { enquiry: GymEnquiry }) => onSaved(data.enquiry));
  const [picked, setPicked] = useState<Option | null>(null);
  const [note, setNote] = useState("");
  const [nextDays, setNextDays] = useState<number | null>(null);
  // Only an open enquiry has a follow-up date to move
  const open = enquiry.status === "new" || enquiry.status === "follow_up";

  const pick = (option: Option) => {
    haptic.select();
    setPicked(option);
    // No answer: try again tomorrow; otherwise in 3 days. Either can be changed.
    setNextDays(open ? (option.outcome === "no_answer" ? 1 : 3) : null);
  };
  const submit = () => {
    if (!picked) return;
    const trimmed = note.trim();
    save((token) =>
      gymApi.addContact(token, enquiry.id, {
        kind: picked.kind,
        outcome: picked.outcome,
        ...(trimmed ? { note: trimmed } : {}),
        ...(open && nextDays !== null ? { followUpOn: daysFromToday(nextDays) } : {}),
      }),
    );
  };

  const iconOf = (option: Option, size: number) =>
    option.icon === "whatsapp" ? <WhatsAppMark size={size + 4} /> : <GymIcon name={option.icon} size={size} color={option.outcome === "no_answer" ? colors.gymDanger : colors.gymPrimary} />;
  const iconGround = (option: Option) => (option.outcome === "no_answer" ? colors.gymDangerSoft : colors.gymPrimarySoft);

  if (!picked) {
    return (
      <GymSheet title={afterCall ? "How did it go?" : "Log a contact"} subtitle={afterCall ? `Your call to ${enquiry.name}` : `With ${enquiry.name}, today`} onClose={onClose}>
        {/* Settings-style rows in one card, a line between each, so every tappable row is clear */}
        <View className="gym-dash-card">
          {(afterCall ? AFTER_CALL : ANY).map((option, index) => (
            <Pressable key={option.label} onPress={() => pick(option)} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }} accessibilityRole="button" accessibilityLabel={option.label}>
              <View className="gym-dash-row__icon" style={{ backgroundColor: iconGround(option) }}>{iconOf(option, 18)}</View>
              <Text className="gym-dash-row__title min-w-0 flex-1" numberOfLines={2}>{option.label}</Text>
              <GymIcon name="chevron-right" size={14} color={colors.gymFaint} />
            </Pressable>
          ))}
          {afterCall && (
            <Pressable onPress={onClose} className="gym-dash-row" style={{ borderTopWidth: 1 }} accessibilityRole="button" accessibilityLabel="Skip logging this call">
              <View className="gym-dash-row__icon" style={{ backgroundColor: colors.gymBar }}>
                <GymIcon name="x" size={18} color={colors.gymMuted} />
              </View>
              <Text className="gym-dash-row__title min-w-0 flex-1" style={{ color: colors.gymMuted }}>Skip</Text>
            </Pressable>
          )}
        </View>
      </GymSheet>
    );
  }

  const reached = picked.outcome !== "no_answer";
  const phrases = reached ? SAID_REACHED : SAID_NO_ANSWER;
  const keepLabel = enquiry.followUpOn ? `Keep ${shortDate(enquiry.followUpOn)}` : "No date";
  return (
    <GymSheet title="Log a contact" subtitle={`With ${enquiry.name}, today`} onClose={onClose}>
      {/* What was picked, with Change to go back */}
      <View className="gym-dash-card">
        <View className="gym-dash-row">
          <View className="gym-dash-row__icon" style={{ backgroundColor: iconGround(picked) }}>{iconOf(picked, 18)}</View>
          <Text className="gym-dash-row__title min-w-0 flex-1" numberOfLines={2}>{picked.label}</Text>
          <Pressable onPress={() => { haptic.select(); setPicked(null); }} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change how it went">
            <Text className="gym-link">Change</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text className="gym-field__label" style={{ fontSize: 14 }}>{reached ? "What did they say?" : "Note (optional)"}</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {phrases.map((phrase) => {
            const selected = noteHas(note, phrase);
            return (
              <PressableScale key={phrase} onPress={() => { haptic.select(); setNote((n) => toggleSaid(n, phrase)); }} className={selected ? "gym-choice gym-choice--selected" : "gym-choice"} style={{ minHeight: 32 }} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={selected ? `Remove ${phrase}` : `Add ${phrase}`}>
                  <Text className={selected ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{phrase}</Text>
                </PressableScale>
            );
          })}
        </View>
        <GymField label="In their words (optional)" value={note} onChangeText={setNote} maxLength={CONTACT_NOTE_MAX} placeholder={reached ? "Eg. Coming Saturday with a friend" : "Eg. Try after 6 pm"} multiline style={{ minHeight: 72, textAlignVertical: "top" }} />
      </View>

      {open && (
        <View style={{ gap: 8 }}>
          <Text className="gym-field__label" style={{ fontSize: 14 }}>Next follow-up</Text>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {NEXT_FOLLOW_UP.map((choice) => {
              const selected = choice.days === nextDays;
              const label = choice.days === null ? keepLabel : choice.label;
              return (
                <PressableScale key={choice.label} onPress={() => { haptic.select(); setNextDays(choice.days); }} className={selected ? "gym-choice gym-choice--selected" : "gym-choice"} style={{ minHeight: 32 }} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={choice.days === null ? keepLabel : `Follow up in ${choice.label.toLowerCase()}`}>
                  <Text className={selected ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{label}</Text>
                </PressableScale>
              );
            })}
          </View>
          {nextDays !== null ? <Text className="gym-tx__meta">{`Call them again on ${shortDate(daysFromToday(nextDays))}`}</Text> : null}
        </View>
      )}

      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Save log" icon="circle-check" ready busy={busy} onPress={submit} />
    </GymSheet>
  );
}
