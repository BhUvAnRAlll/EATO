import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { DateSelect } from "@/components/gym/DateSelect";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { OpeningHoursEditor } from "@/components/gym/OpeningHoursEditor";
import { DraftNote, ProfileLoad, useProfileDraft } from "@/components/gym/ProfileParts";
import { SaveButton } from "@/components/gym/SaveButton";
import { daysFromToday, todayIso } from "@/data/gymDashboard";
import { gymApi, type GymProfile, type GymProfileFields } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { CLOSURE_NOTE_MAX, CLOSURES_MAX, closureDateText, hoursProblem, sameHours, startingHours, type Closure, type OpeningHours } from "@/lib/gymProfile";
import { useThemeColors } from "@/theme";

// Gym Profile › Opening hours and closures (2026-11-09): every day's sessions (up to two, or
// Closed: a weekly holiday is a day with no sessions), and special closures from today to a year
// ahead (a festival, renovation), each with an optional note. Saved to the draft together; past
// closures drop off by themselves.
export default function GymProfileHours() {
  const { result, retry, canEdit } = useProfileDraft();
  return (
    <GymScreen title="Opening hours">
      <ProfileLoad result={result} retry={retry}>{(profile) => <HoursForm saved={profile} canEdit={canEdit} />}</ProfileLoad>
    </GymScreen>
  );
}

function HoursForm({ saved, canEdit }: { saved: GymProfile; canEdit: boolean }) {
  const colors = useThemeColors();
  const [current, setCurrent] = useState(saved);
  const [hours, setHours] = useState<OpeningHours | null>(saved.hours);
  const [closures, setClosures] = useState<Closure[]>(saved.closures);
  const [date, setDate] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useGymSave((data: GymProfile) => {
    setCurrent(data);
    setClosures(data.closures);
  }, "Saved to your draft");

  const today = todayIso();
  const taken = date !== null && closures.some((c) => c.date === date);
  const addClosure = () => {
    if (!date || taken) return;
    setClosures((list) => [...list, { date, note: note.trim() || null }].sort((a, b) => a.date.localeCompare(b.date)));
    setDate(null);
    setNote("");
  };

  const changes: GymProfileFields = {};
  if (!sameHours(hours, current.hours)) changes.hours = hours;
  if (JSON.stringify(closures) !== JSON.stringify(current.closures)) changes.closures = closures;
  const problem = hours ? hoursProblem(hours) : null;
  const ready = canEdit && !problem && Object.keys(changes).length > 0;

  return (
    <>
      <Text className="gym-page-section">Every week</Text>
      <Text className="gym-tx__meta">Set a day to Closed for your weekly holiday.</Text>
      {hours === null ? (
        <View style={{ gap: 8 }}>
          <Text className="gym-tx__meta">Not added yet. Members will see when you are open.</Text>
          {canEdit && (
            <PressableScale onPress={() => setHours(startingHours())} className="gym-choice flex-row items-center self-start" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Add opening hours">
              <GymIcon name="clock" size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Add opening hours</Text>
            </PressableScale>
          )}
        </View>
      ) : (
        <View className="gym-dash-card" style={{ paddingHorizontal: 14 }} pointerEvents={canEdit ? "auto" : "none"}>
          <OpeningHoursEditor hours={hours} onChange={setHours} />
          {canEdit && (
            <PressableScale onPress={() => setHours(null)} className="self-start" style={{ paddingBottom: 12 }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove the opening hours">
              <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>Remove opening hours</Text>
            </PressableScale>
          )}
        </View>
      )}
      {problem ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{problem}</Text> : null}

      <Text className="gym-page-section" style={{ marginTop: 8 }}>Special closures</Text>
      <Text className="gym-tx__meta">{"Festivals, maintenance or any day you're shut. Members see them under your hours."}</Text>
      {closures.length > 0 && (
        <View className="gym-dash-card">
          {closures.map((c, index) => (
            <View key={c.date} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }}>
              <View className="gym-dash-row__icon bg-gym-primary-soft">
                <GymIcon name="calendar-x" size={18} color={colors.gymPrimary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="gym-dash-row__title">{closureDateText(c.date)}</Text>
                {c.note ? <Text className="gym-dash-row__text" numberOfLines={2}>{c.note}</Text> : null}
              </View>
              {canEdit && (
                <PressableScale onPress={() => setClosures((list) => list.filter((x) => x.date !== c.date))} className="gym-icon-btn" hitSlop={4} accessibilityRole="button" accessibilityLabel={`Remove the closure on ${closureDateText(c.date)}`}>
                  <GymIcon name="trash-2" size={15} color={colors.gymDanger} />
                </PressableScale>
              )}
            </View>
          ))}
        </View>
      )}
      {canEdit && closures.length < CLOSURES_MAX && (
        <View className="gym-dash-card" style={{ padding: 14, gap: 10 }}>
          <DateSelect label="Closed on" value={date} onChange={setDate} min={today} max={daysFromToday(365)} />
          <GymField label="Note (optional)" icon="notebook-pen" value={note} onChangeText={(t) => setNote(t.slice(0, CLOSURE_NOTE_MAX))} placeholder="Eg. Diwali" maxLength={CLOSURE_NOTE_MAX} />
          {taken ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>That day is already added.</Text> : null}
          <PressableScale onPress={addClosure} disabled={!date || taken} className="gym-choice flex-row items-center self-start" style={{ gap: 6, opacity: !date || taken ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Add this closure">
            <GymIcon name="plus" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Add closure</Text>
          </PressableScale>
        </View>
      )}

      {error ? <FormAlert message={error} /> : null}
      {canEdit && <SaveButton label="Save to draft" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateProfile(token, changes))} />}
      <DraftNote canEdit={canEdit} />
    </>
  );
}
