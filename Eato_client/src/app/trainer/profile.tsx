import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { PostSkeleton } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { coachingModeLabels, specialties, specialtyLabels, type CoachingMode, type Specialty } from "@/lib/trainerRules";
import { trainers, type TrainerProfileDraft } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const input = { borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.forestInk } as const;
const lines = (text: string) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

// The trainer's own profile: what members see in Find Trainers. The coaching approach,
// qualifications and languages show to a member only after the trainer accepts them.
// Saving it is what makes the trainer findable (with "Accepting clients" on).
export default function TrainerOwnProfile() {
  const getToken = useSessionToken();
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ title: "", bio: "", years: "0", availability: "", approach: "", qualifications: "", languages: "" });
  const [chosen, setChosen] = useState<Specialty[]>([]);
  const [mode, setMode] = useState<CoachingMode>("online");
  const [offersNutrition, setOffersNutrition] = useState(false);
  const [accepting, setAccepting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (loaded) return;
    const result = await trainers.ownProfile(await getToken());
    if (!result.ok) return setError(result.error);
    const p = result.data.profile;
    if (p) {
      setForm({ title: p.title, bio: p.bio, years: String(p.yearsExperience), availability: p.availability ?? "", approach: p.approach ?? "", qualifications: (p.qualifications ?? []).join("\n"), languages: (p.languages ?? []).join(", ") });
      setChosen(p.specialties);
      setMode(p.coachingMode);
      setOffersNutrition(p.offersNutrition);
      setAccepting(p.acceptingClients);
    }
    setLoaded(true);
  }, [loaded, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    if (form.title.trim().length < 2) return setError("Add a title, for example Strength coach.");
    if (chosen.length === 0) return setError("Pick at least one specialty.");
    if (form.bio.trim().length < 10) return setError("Write a short bio (10 characters or more).");
    const draft: TrainerProfileDraft = {
      title: form.title.trim(), specialties: chosen, yearsExperience: Math.min(60, Number(form.years) || 0), bio: form.bio.trim(), coachingMode: mode,
      offersNutrition, acceptingClients: accepting, availability: form.availability.trim() || null, approach: form.approach.trim() || null,
      qualifications: lines(form.qualifications), languages: lines(form.languages),
    };
    setSaving(true);
    setError(null);
    const result = await trainers.saveOwnProfile(await getToken(), draft);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setSaved(true);
  };

  if (!loaded && !error) return <AdminScreen title="My trainer profile"><PostSkeleton /></AdminScreen>;

  const field = (label: string, key: keyof typeof form, opts: { multiline?: boolean; placeholder?: string; max?: number; numeric?: boolean } = {}) => (
    <View key={key}>
      <Text className="auth__label mb-2">{label}</Text>
      <TextInput value={form[key]} onChangeText={set(key)} placeholder={opts.placeholder} placeholderTextColor={colors.faint} multiline={opts.multiline} maxLength={opts.max} keyboardType={opts.numeric ? "number-pad" : "default"} accessibilityLabel={label} style={{ ...input, minHeight: opts.multiline ? 84 : 46, textAlignVertical: opts.multiline ? "top" : "center" }} />
    </View>
  );

  return (
    <AdminScreen title="My trainer profile" subtitle="Members find you under Community → Trainers.">
      <View className="gap-3">
        {field("Title", "title", { placeholder: "Strength coach", max: 80 })}
        <Text className="auth__label">Specialties</Text>
        <View className="flex-row flex-wrap gap-2">
          {specialties.map((s) => {
            const selected = chosen.includes(s);
            return (
              <Pressable key={s} onPress={() => setChosen((c) => (selected ? c.filter((x) => x !== s) : [...c, s]))} className={selected ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}>
                <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{specialtyLabels[s]}</Text>
              </Pressable>
            );
          })}
        </View>
        {field("Bio", "bio", { multiline: true, placeholder: "Who you coach and how", max: 300 })}
        {field("Years of experience", "years", { numeric: true, max: 2 })}
        <Text className="auth__label">Coaching</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {(Object.keys(coachingModeLabels) as CoachingMode[]).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} className={mode === m ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: mode === m }}>
              <Text className={mode === m ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{coachingModeLabels[m]}</Text>
            </Pressable>
          ))}
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="auth__label flex-1">Offer nutrition coaching (diet plans and targets)</Text>
          <Switch value={offersNutrition} onValueChange={setOffersNutrition} trackColor={{ true: colors.forest }} accessibilityLabel="Offer nutrition coaching" />
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="auth__label flex-1">Accepting new clients</Text>
          <Switch value={accepting} onValueChange={setAccepting} trackColor={{ true: colors.forest }} accessibilityLabel="Accepting new clients" />
        </View>
        {field("Availability", "availability", { placeholder: "Mon–Sat, 6–10am", max: 120 })}
        <Text className="home__note">Shown to your clients only, after you accept them:</Text>
        {field("Coaching approach", "approach", { multiline: true, max: 1000 })}
        {field("Qualifications (one per line)", "qualifications", { multiline: true, placeholder: "ACE CPT" })}
        {field("Languages", "languages", { placeholder: "English, Kannada" })}
        {error && <FormAlert message={error} />}
        {saved && !error && <Text className="home__note">Saved. Members can find you now{accepting ? "" : " (but you're not accepting new clients)"}.</Text>}
        <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Save trainer profile">
          {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Save profile</Text>}
        </Pressable>
      </View>
    </AdminScreen>
  );
}
