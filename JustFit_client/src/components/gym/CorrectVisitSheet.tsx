import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { DateSelect } from "@/components/gym/DateSelect";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { gymApi, type GymVisit } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

const IST_OFFSET_MS = 330 * 60 * 1000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const indiaDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
const indiaTime = (iso: string) => new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(11, 16);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// "630" or "6:30" → "06:30" as it's typed
const tidyTime = (text: string) => {
  const digits = text.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, digits.length - 2).padStart(2, "0")}:${digits.slice(-2)}`;
};

// Attendance › a member's visits › Correct a visit, or Add a missed visit (Attendance › Correct visits
// and add missed ones): the day (a missed visit only, up to 30 days back), check-in and check-out in
// India's time, and the reason, which is kept with the times before and after. The server checks
// everything again (gym/correctionRules.js).
export function CorrectVisitSheet({ memberId, memberName, visit, onClose, onSaved }: { memberId: number; memberName: string; visit: GymVisit | null; onClose: () => void; onSaved: () => void }) {
  const [today] = useState(() => indiaDay(Date.now()));
  const [date, setDate] = useState(visit ? visit.date : addDays(today, -1));
  const [inTime, setInTime] = useState(visit ? indiaTime(visit.checkedInAt) : "");
  const [outTime, setOutTime] = useState(visit?.checkedOutAt ? indiaTime(visit.checkedOutAt) : "");
  const [reason, setReason] = useState("");
  const save = useGymSave(() => onSaved(), visit ? "Visit corrected" : "Visit added");

  const problem = !TIME.test(inTime) ? "Enter the check-in time as HH:MM."
    : outTime !== "" && !TIME.test(outTime) ? "Enter the check-out time as HH:MM."
    : outTime === "" && (!visit || date < today) ? "Enter the check-out time."
    : outTime !== "" && outTime <= inTime ? "The check-out must be after the check-in."
    : reason.trim().length < 5 ? "Write why it's being corrected."
    : null;

  const submit = () => {
    if (problem) return;
    save.save((token) =>
      visit
        ? gymApi.correctVisit(token, visit.id, { inTime, outTime: outTime === "" ? null : outTime, reason: reason.trim() })
        : gymApi.addVisit(token, { memberId, date, inTime, outTime, reason: reason.trim() }),
    );
  };

  return (
    <GymSheet title={visit ? "Correct visit" : "Add a missed visit"} subtitle={memberName} onClose={onClose}>
      <View style={{ gap: 14 }}>
        {visit ? (
          <Text className="gym-tx__meta">{`Visit on ${visit.date}. The times before and after are kept with your reason.`}</Text>
        ) : (
          <DateSelect label="Day of the visit" value={date} onChange={setDate} min={addDays(today, -30)} max={today} />
        )}
        <View className="flex-row" style={{ gap: 10 }}>
          <View className="flex-1">
            <GymField label="Check-in (HH:MM)" icon="log-in" value={inTime} onChangeText={(t) => setInTime(tidyTime(t))} keyboardType="number-pad" placeholder="06:30" maxLength={5} pinLabel />
          </View>
          <View className="flex-1">
            <GymField label="Check-out (HH:MM)" icon="log-out" value={outTime} onChangeText={(t) => setOutTime(tidyTime(t))} keyboardType="number-pad" placeholder="07:45" maxLength={5} pinLabel />
          </View>
        </View>
        <GymField label="Reason" icon="message-square" value={reason} onChangeText={(t) => setReason(t.slice(0, 200))} maxLength={200} placeholder="e.g. Forgot to scan the QR code" />
        {problem && (inTime || outTime || reason) ? <Text className="gym-tx__meta">{problem}</Text> : null}
        {save.error ? <FormAlert message={save.error} /> : null}
        <GymPrimaryButton label={visit ? "Save correction" : "Add visit"} ready={!problem} busy={save.busy} icon="check" onPress={submit} />
      </View>
    </GymSheet>
  );
}
