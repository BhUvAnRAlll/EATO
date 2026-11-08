import { useState } from "react";
import { Text } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { DateSelect } from "@/components/gym/DateSelect";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { daysFromToday, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymMember, type GymMemberDetail } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { addDaysIso } from "@/lib/gymDates";

// The same limits as the server's pauseRules (a staff pause may start up to 30 days back)
const MAX_DAYS = 90;
const MAX_BACK = 30;
const MAX_AHEAD = 60;
const daysBetween = (from: string, until: string) => Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

// ⋯ › Membership › Pause Membership (the user's Option B): the staff pause a member's plan
// themselves: the first and last paused day, the reason, then "Please confirm the details". The
// pause is approved at once and its days are added to the plan's end.
export function PauseMembershipSheet({ member, onClose, onSaved }: { member: GymMember; onClose: () => void; onSaved: (detail: GymMemberDetail) => void }) {
  const [from, setFrom] = useState(daysFromToday(0));
  const [until, setUntil] = useState(daysFromToday(6));
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { busy, error, save } = useGymSave(onSaved);
  const days = until >= from ? daysBetween(from, until) : 0;
  const trimmed = reason.trim();
  const ready = days >= 1 && days <= MAX_DAYS && trimmed.length >= 3 && from <= member.expiresOn;
  const wouldEnd = addDaysIso(member.expiresOn, days);
  const hint = days > MAX_DAYS ? `A pause is at most ${MAX_DAYS} days.` : from > member.expiresOn ? "The pause would start after the plan ends." : days > 0 ? `${days} ${days === 1 ? "day" : "days"} · the plan would end on ${shortDate(wouldEnd)} instead of ${shortDate(member.expiresOn)}.` : "Pick the first and last paused day.";

  const changeFrom = (iso: string) => {
    setFrom(iso);
    if (until < iso || daysBetween(iso, until) > MAX_DAYS) setUntil(iso);
  };
  const submit = () => {
    setConfirming(false);
    save((token) => gymApi.pauseMember(token, member.id, { from, until, reason: trimmed }));
  };

  return (
    <GymSheet
      title="Pause Membership"
      subtitle={`${member.name} · ${member.code}`}
      onClose={onClose}
      onDismissOverlay={() => setConfirming(false)}
      overlay={
        confirming ? (
          <ConfirmDialog
            rows={[["Member", member.name], ["From", shortDate(from)], ["Until", shortDate(until)], ["Days", String(days)], ["Plan ends on", shortDate(wouldEnd)], ["Reason", trimmed]]}
            onEdit={() => setConfirming(false)}
            onConfirm={submit}
            confirmLabel="Pause"
          />
        ) : null
      }
    >
      <DateSelect label="Pause from" value={from} onChange={changeFrom} min={daysFromToday(-MAX_BACK)} max={daysFromToday(MAX_AHEAD)} />
      <DateSelect label="Pause until" value={until} onChange={setUntil} min={from} max={addDaysIso(from, MAX_DAYS - 1)} />
      <GymField label="Reason" icon="file-text" value={reason} onChangeText={(t) => setReason(t.slice(0, 200))} maxLength={200} placeholder="Travelling, unwell, exams…" multiline style={{ minHeight: 72, textAlignVertical: "top" }} />
      <Text className="gym-tx__meta">{hint}</Text>
      <Text className="gym-tx__meta">{"The member sees the pause on Profile › Gym membership in the justFit app, and can't check in by QR while it runs."}</Text>
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Pause Membership" ready={ready} busy={busy} icon="circle-pause" onPress={() => setConfirming(true)} />
    </GymSheet>
  );
}
