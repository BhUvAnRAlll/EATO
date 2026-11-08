import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { DateSelect } from "@/components/gym/DateSelect";
import { ChipRow } from "@/components/gym/GymChoice";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { ENQUIRY_STATUS_LABEL, INTEREST_LABEL, LEAD_LABEL, SOURCE_LABEL, contactText, daysFromToday, phoneInput, referrerText, shortDate } from "@/data/gymDashboard";
import { gymApi, type EnquiryInterest, type EnquirySource, type EnquiryStatus, type GymEnquiry } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

const QUICK = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "In 1 week", days: 7 },
];
// What the gym admin can set by hand; Joined comes from Convert to member
const STATUSES: Partial<Record<EnquiryStatus, string>> = { new: ENQUIRY_STATUS_LABEL.new, follow_up: ENQUIRY_STATUS_LABEL.follow_up, lost: ENQUIRY_STATUS_LABEL.lost };

// Manage › Enquiry › + (Add Enquiry) or an enquiry's ⋯ (edit): the name and mobile, what they're
// interested in, how they found the gym (a referral also takes the mobile number of the person
// who referred them, 2026-11-08), a note, and the day to call them back (quick picks or
// any date). Editing adds the status (New, Follow-up, Not interested) and Convert to member,
// which opens Add Member with their name and number; once saved there the enquiry is Joined.
export function EnquirySheet({ enquiry, onClose, onSaved, onConvert, onOpenMember }: {
  enquiry: GymEnquiry | null;
  onClose: () => void;
  onSaved: (enquiry: GymEnquiry) => void;
  onConvert?: (enquiry: GymEnquiry) => void;
  onOpenMember?: (memberId: number) => void;
}) {
  const colors = useThemeColors();
  const [name, setName] = useState(enquiry?.name ?? "");
  const [phone, setPhone] = useState(enquiry?.phone?.replace(/^\+91/, "") ?? "");
  const [interest, setInterest] = useState<EnquiryInterest | "">(enquiry?.interest ?? "");
  const [source, setSource] = useState<EnquirySource | "">(enquiry?.source ?? "");
  const [referredBy, setReferredBy] = useState(enquiry?.referredBy?.phone.replace(/^\+91/, "") ?? "");
  const [note, setNote] = useState(enquiry?.note ?? "");
  const [followUpOn, setFollowUpOn] = useState<string | null>(enquiry?.followUpOn ?? null);
  const [status, setStatus] = useState<EnquiryStatus>(enquiry?.status ?? "new");
  const { busy, error, save } = useGymSave((data: { enquiry: GymEnquiry }) => onSaved(data.enquiry));

  const joined = enquiry?.status === "joined";
  const phoneOk = phone.length === 0 || /^[6-9]\d{9}$/.test(phone);
  // A referral needs the referrer's number, and it can't be their own
  const referral = source === "referral";
  const referrerValid = /^[6-9]\d{9}$/.test(referredBy);
  const referrerSelf = referrerValid && referredBy === phone;
  const referrerOk = !referral || (referrerValid && !referrerSelf);
  const referrerHint = !referral || referredBy.length === 0 ? undefined : !referrerValid ? "Enter a 10-digit mobile number starting with 6, 7, 8 or 9." : referrerSelf ? "That's their own number. Enter the number of the person who referred them." : undefined;
  const ready = name.trim().length >= 2 && phoneOk && referrerOk;

  const submit = () =>
    save((token) => {
      const fields = { name: name.trim(), phone, note: note.trim(), interest, source, followUpOn: followUpOn ?? "", referredBy: referral ? referredBy : "" };
      if (!enquiry) return gymApi.addEnquiry(token, fields);
      return gymApi.editEnquiry(token, enquiry.id, joined ? fields : { ...fields, status });
    });

  return (
    <GymSheet title={enquiry ? "Edit Enquiry" : "Add Enquiry"} subtitle={enquiry ? `Asked on ${shortDate(enquiry.enquiredOn)}${enquiry.lead ? ` · ${LEAD_LABEL[enquiry.lead.level]} · ${enquiry.lead.score}` : ""}` : "Someone who asked about joining."} onClose={onClose}>
      {/* Every contact attempt so far (logged from the list's buttons), oldest first */}
      {enquiry && enquiry.contacts.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text className="gym-field__label">Contacts</Text>
          {enquiry.contacts.map((c) => (
            <Text key={c.id} className="gym-tx__meta">{contactText(c)}</Text>
          ))}
        </View>
      )}
      <GymField label="Name" icon="user" value={name} onChangeText={setName} maxLength={80} placeholder="Name (Eg. Priya)" autoCapitalize="words" />
      <GymField label="Mobile number (optional)" icon="phone" value={phone} onChangeText={(t) => setPhone(phoneInput(t))} maxLength={16} keyboardType="phone-pad" placeholder="Mobile Number" hint={phoneOk ? undefined : "Enter a 10-digit mobile number starting with 6, 7, 8 or 9."} />
      <ChipRow label="Interested in" options={INTEREST_LABEL} value={interest} onChange={setInterest} clearable />
      <ChipRow label="Came from" options={SOURCE_LABEL} value={source} onChange={setSource} clearable />
      {referral && (
        <View style={{ gap: 4 }}>
          <GymField label="Referred by, mobile number" icon="user-plus" value={referredBy} onChangeText={(t) => setReferredBy(phoneInput(t))} maxLength={16} keyboardType="phone-pad" placeholder="Referred by (mobile number)" hint={referrerHint} />
          {enquiry?.referredBy && enquiry.referredBy.phone.replace(/^\+91/, "") === referredBy ? (
            <Text className="gym-tx__meta">{referrerText(enquiry.referredBy)}</Text>
          ) : (
            <Text className="gym-tx__meta">{"Who sent them? If they're a member here, their name shows on the enquiry."}</Text>
          )}
        </View>
      )}
      <GymField label="Note (optional)" value={note} onChangeText={setNote} maxLength={200} placeholder="Evening timings? Budget? Goal?" multiline style={{ minHeight: 72, textAlignVertical: "top" }} />

      {!joined && (
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <View className="min-w-0 flex-1">
              <DateSelect label="Follow up on" value={followUpOn} onChange={setFollowUpOn} min={daysFromToday(0)} max={daysFromToday(365)} />
            </View>
            {followUpOn && (
              <PressableScale onPress={() => { haptic.select(); setFollowUpOn(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear the follow-up date">
                <Text className="gym-link">Clear</Text>
              </PressableScale>
            )}
          </View>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {QUICK.map((q) => {
              const iso = daysFromToday(q.days);
              const selected = iso === followUpOn;
              return (
                <PressableScale key={q.label} onPress={() => { haptic.select(); setFollowUpOn(iso); }} className={selected ? "gym-choice gym-choice--selected" : "gym-choice"} style={{ minHeight: 32 }} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Follow up ${q.label.toLowerCase()}`}>
                  <Text className={selected ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{q.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </View>
      )}

      {enquiry && !joined && <ChipRow label="Status" options={STATUSES as Record<EnquiryStatus, string>} value={status} onChange={(s) => s && setStatus(s)} />}

      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label={enquiry ? "Save changes" : "Save enquiry"} ready={ready} busy={busy} onPress={submit} />

      {enquiry && !joined && onConvert && (
        <PressableScale onPress={() => onConvert(enquiry)} className="gym-btn gym-btn--outline flex-row items-center justify-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel={`Convert ${enquiry.name} to a member`}>
          <GymIcon name="user-plus" size={18} color={colors.gymPrimary} />
          <Text className="gym-btn__label gym-btn__label--outline">Convert to member</Text>
        </PressableScale>
      )}
      {joined && enquiry?.member && (
        <PressableScale onPress={() => onOpenMember?.(enquiry.member!.id)} className="gym-btn gym-btn--outline flex-row items-center justify-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel={`Joined as ${enquiry.member.code}. Open the member`}>
          <GymIcon name="badge-check" size={18} color={colors.gymSuccess} />
          <Text className="gym-btn__label gym-btn__label--outline">{`Joined as ${enquiry.member.code}`}</Text>
        </PressableScale>
      )}
    </GymSheet>
  );
}
