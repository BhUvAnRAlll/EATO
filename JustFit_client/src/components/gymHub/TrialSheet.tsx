import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { FieldInput } from "@/components/FieldInput";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { discoverApi, type JoinRequest } from "@/lib/discoverApi";
import { TRIAL_EXPERIENCE, TRIAL_GENDERS, TRIAL_GOALS, TRIAL_NOTE_MAX, TRIAL_TIMES, trialDays, trialPrefill, type TrialExperience, type TrialGender, type TrialGoal, type TrialTime } from "@/lib/gymTrial";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { todayIso } from "@/lib/macro";
import { fetchProfile } from "@/lib/profile";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// A row of choices; tapping the chosen one again clears it (unless `required`)
function Chips<T extends string>({ options, value, onChange, required = false, label }: { options: { id: T; label: string }[]; value: T | null; onChange: (v: T | null) => void; required?: boolean; label: string }) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              haptic.select();
              onChange(on && !required ? null : o.id);
            }}
            className={on ? "setup__chip setup__chip--selected" : "setup__chip"}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const Label = ({ children }: { children: string }) => <Text className="type-subhead text-forest-ink">{children}</Text>;

// Gym Hub › a gym › Book a free trial (2026-11-10): the member's details, filled in from their
// profile and editable (the number is always the account's), a day in the next two weeks, a time
// of day and an optional message. It goes to the gym's Enquiries; the gym calls and books the time,
// and the member sees it on the gym's page and in their notifications.
export function TrialSheet({ gymId, gymName, onClose, onSent }: { gymId: number; gymName: string; onClose: () => void; onSent: (request: JoinRequest) => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const user = useAuthStore((state) => state.user);
  const [today] = useState(todayIso);
  const days = trialDays(today);
  const [name, setName] = useState(user?.fullName?.trim() ?? "");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<TrialGender | null>(null);
  const [goal, setGoal] = useState<TrialGoal | null>(null);
  const [experience, setExperience] = useState<TrialExperience | null>(null);
  const [day, setDay] = useState(today);
  const [time, setTime] = useState<TrialTime | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<JoinRequest | null>(null);
  const sending = useRef(false);
  // Only what the member hasn't touched yet is filled in when the profile arrives
  const touched = useRef(new Set<string>());
  const touch = (field: string) => touched.current.add(field);

  useEffect(() => {
    let live = true;
    (async () => {
      const answer = await fetchProfile(await getToken().catch(() => null));
      if (!live || !answer.ok) return;
      const filled = trialPrefill(answer.data.profile, user?.fullName, today);
      if (!touched.current.has("name") && filled.name) setName(filled.name);
      if (!touched.current.has("age") && filled.age !== null) setAge(String(filled.age));
      if (!touched.current.has("gender") && filled.gender) setGender(filled.gender);
      if (!touched.current.has("goal") && filled.goal) setGoal(filled.goal);
    })();
    return () => {
      live = false;
    };
  }, [getToken, user?.fullName, today]);

  const ageNumber = age.trim() === "" ? null : Number(age);
  const ageOk = ageNumber === null || (Number.isInteger(ageNumber) && ageNumber >= 13 && ageNumber <= 90);
  const ready = name.trim().length >= 2 && ageOk && time !== null;

  const send = async () => {
    if (sending.current || !time) return;
    if (!ageOk) return setError("Age must be a whole number from 13 to 90.");
    sending.current = true;
    setBusy(true);
    setError("");
    const answer = await discoverApi.trial(await getToken().catch(() => null), gymId, { name: name.trim(), age: ageNumber, gender, goal, experience, day, time, note: note.trim() || null });
    setBusy(false);
    sending.current = false;
    if (!answer.ok) return setError(answer.error);
    hud.success("Trial requested");
    setSent(answer.data.request);
    onSent(answer.data.request);
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {(dismiss) => (
        <KeyboardAvoider fill={false}>
          <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {sent ? (
              <>
                <View className="items-center" style={{ gap: 8 }}>
                  <View className="card__icon" style={{ backgroundColor: colors.accentSoft }}>
                    <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={22} tintColor={colors.leaf} />
                  </View>
                  <Text className="type-headline text-forest-ink text-center">Trial requested</Text>
                  <Text className="meta-text text-center">{`${gymName} will call you${user?.phone ? ` on +91 ${user.phone}` : ""} to fix the time${sent.trial?.preferred ? ` (you asked for ${sent.trial.preferred})` : ""}. You'll get a notification once it's booked.`}</Text>
                </View>
                <PrimaryButton label="Done" onPress={dismiss} />
              </>
            ) : (
              <>
                <View className="gap-1">
                  <Text className="type-headline text-forest-ink">Book a free trial</Text>
                  <Text className="meta-text">{`${gymName} calls you to book the time. Your details are filled in from your profile; change anything you like.`}</Text>
                </View>

                <View className="gap-2">
                  <Label>Your name</Label>
                  <View className="setup__field">
                    <FieldInput value={name} onChangeText={(t) => { touch("name"); setName(t.slice(0, 80)); }} placeholder="Full name" autoCapitalize="words" maxLength={80} accessibilityLabel="Your name" />
                  </View>
                  <Text className="type-caption text-muted">{user?.phone ? `The gym calls you on +91 ${user.phone}` : "The gym calls you on your account's number"}</Text>
                </View>

                <View className="gap-2">
                  <Label>Age</Label>
                  <View className="setup__field">
                    <FieldInput value={age} onChangeText={(t) => { touch("age"); setAge(t.replace(/[^0-9]/g, "").slice(0, 2)); }} placeholder="Eg. 27" keyboardType="number-pad" maxLength={2} accessibilityLabel="Age" />
                  </View>
                  {!ageOk && <Text className="type-caption" style={{ color: colors.danger }}>Age must be from 13 to 90.</Text>}
                </View>

                <View className="gap-2">
                  <Label>Gender</Label>
                  <Chips label="Gender" options={TRIAL_GENDERS} value={gender} onChange={(v) => { touch("gender"); setGender(v); }} />
                </View>

                <View className="gap-2">
                  <Label>Your goal</Label>
                  <Chips label="Your goal" options={TRIAL_GOALS} value={goal} onChange={(v) => { touch("goal"); setGoal(v); }} />
                </View>

                <View className="gap-2">
                  <Label>Experience</Label>
                  <Chips label="Experience" options={TRIAL_EXPERIENCE} value={experience} onChange={setExperience} />
                </View>

                <View className="gap-2">
                  <Label>When would you like to come?</Label>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                    {days.map((d) => {
                      const on = d.day === day;
                      return (
                        <Pressable
                          key={d.day}
                          onPress={() => { haptic.select(); setDay(d.day); }}
                          className={on ? "setup__chip setup__chip--selected items-center" : "setup__chip items-center"}
                          style={{ minWidth: 72 }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${d.top}, ${d.bottom}`}
                        >
                          <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{d.top}</Text>
                          <Text className="type-caption text-muted">{d.bottom}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <Chips label="Time of day" required options={TRIAL_TIMES.map((t) => ({ id: t.id, label: `${t.label} · ${t.hint}` }))} value={time} onChange={(v) => v && setTime(v)} />
                </View>

                <View className="gap-2">
                  <Label>Message (optional)</Label>
                  <View className="setup__field" style={{ minHeight: 80, alignItems: "flex-start", paddingVertical: 10 }}>
                    <TextInput
                      value={note}
                      onChangeText={(t) => setNote(t.slice(0, TRIAL_NOTE_MAX))}
                      placeholder="Eg. I have a knee injury. Please call after 6 pm."
                      placeholderTextColor={colors.faint}
                      multiline
                      maxLength={TRIAL_NOTE_MAX}
                      textAlignVertical="top"
                      style={{ flex: 1, alignSelf: "stretch", minHeight: 60, fontFamily: "Poppins-Regular", fontSize: 14, color: colors.ink, paddingVertical: 0 }}
                      accessibilityLabel="Message for the gym"
                    />
                  </View>
                </View>

                {error ? <FormAlert message={error} /> : null}
                <PrimaryButton label="Request free trial" onPress={send} loading={busy} disabled={!ready} />
                {!time && <Text className="type-caption text-muted text-center">Pick a time of day to send it.</Text>}
                <Pressable onPress={dismiss} disabled={busy} className="self-center" hitSlop={10} accessibilityRole="button">
                  <Text className="auth__note-link">Not now</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
