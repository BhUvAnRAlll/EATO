import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { DateSelect } from "@/components/gym/DateSelect";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { gymApi, type GymEnquiry } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { clockText, quickTimes, trialCardText, trialDetailsText } from "@/lib/gymTrial";

const IST_OFFSET_MS = 330 * 60 * 1000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const indiaDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// "630" or "6:30" → "06:30" as it's typed
const tidyTime = (text: string) => {
  const digits = text.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, digits.length - 2).padStart(2, "0")}:${digits.slice(-2)}`;
};

// Enquiries › a free trial request (2026-11-10): what the member told the gym (age, gender, goal,
// experience, when they'd like to come, their note), then Book: a day (today to 60 days ahead) and a
// time, quick picks near what they asked for. Booking tells the member. Once booked it can be moved,
// or marked Done or No-show after the visit; the enquiry stays open to convert to a member.
export function TrialScheduleSheet({ enquiry, onClose, onSaved }: { enquiry: GymEnquiry; onClose: () => void; onSaved: () => void }) {
  const trial = enquiry.trial!;
  const [today] = useState(() => indiaDay(Date.now()));
  const start = trial.at?.day ?? (trial.details && trial.details.day >= today ? trial.details.day : today);
  const [day, setDay] = useState(start);
  const [time, setTime] = useState(trial.at?.time ?? "");
  const booked = trial.status === "scheduled";
  const save = useGymSave(() => onSaved(), booked ? "Trial moved" : "Trial booked");
  const mark = useGymSave(() => onSaved(), "Trial updated");
  const details = trialDetailsText(trial);
  const problem = !TIME.test(time) ? "Pick or type the time as HH:MM." : null;
  const open = trial.status === "requested" || trial.status === "scheduled";

  return (
    <GymSheet title={booked ? "Free trial" : "Book the free trial"} subtitle={enquiry.name} onClose={onClose}>
      <View style={{ gap: 14 }}>
        <View className="gym-dash-card" style={{ gap: 4 }}>
          <Text className="gym-member-card__line">{trialCardText(trial)}</Text>
          {details ? <Text className="gym-tx__meta">{details}</Text> : null}
          {trial.preferred ? <Text className="gym-tx__meta">{`Asked for ${trial.preferred}`}</Text> : null}
          {enquiry.note ? <Text className="gym-tx__meta">{`“${enquiry.note}”`}</Text> : null}
        </View>

        {open ? (
          <>
            <DateSelect label="Trial day" value={day} onChange={setDay} min={today} max={addDays(today, 60)} />
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {quickTimes(trial.details?.time).map((t) => {
                const on = t === time;
                return (
                  <PressableScale key={t} onPress={() => setTime(t)} haptic="select" className={on ? "gym-filter gym-filter--selected" : "gym-filter"} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text className={on ? "gym-filter__label gym-filter__label--selected" : "gym-filter__label"}>{clockText(t)}</Text>
                  </PressableScale>
                );
              })}
            </View>
            <GymField label="Time (HH:MM, 24-hour)" icon="calendar-clock" value={time} onChangeText={(t) => setTime(tidyTime(t))} keyboardType="number-pad" placeholder="18:30" maxLength={5} pinLabel />
            {problem && time ? <Text className="gym-tx__meta">{problem}</Text> : null}
            {save.error ? <FormAlert message={save.error} /> : null}
            <GymPrimaryButton label={booked ? "Move the trial" : "Book trial"} ready={!problem} busy={save.busy} icon="calendar" onPress={() => !problem && save.save((token) => gymApi.scheduleTrial(token, enquiry.id, { day, time }))} />
            <Text className="gym-tx__meta">{`${enquiry.name} gets a notification with the day and time.`}</Text>
          </>
        ) : null}

        {booked && (
          <View className="flex-row" style={{ gap: 10 }}>
            <PressableScale onPress={() => mark.save((token) => gymApi.trialOutcome(token, enquiry.id, "done"))} disabled={mark.busy} haptic="tap" className="gym-btn gym-btn--outline flex-1" accessibilityRole="button">
              <Text className="gym-btn__label gym-btn__label--outline">They came</Text>
            </PressableScale>
            <PressableScale onPress={() => mark.save((token) => gymApi.trialOutcome(token, enquiry.id, "no_show"))} disabled={mark.busy} haptic="tap" className="gym-btn gym-btn--outline flex-1" accessibilityRole="button">
              <Text className="gym-btn__label gym-btn__label--outline">No-show</Text>
            </PressableScale>
          </View>
        )}
        {mark.error ? <FormAlert message={mark.error} /> : null}
      </View>
    </GymSheet>
  );
}
