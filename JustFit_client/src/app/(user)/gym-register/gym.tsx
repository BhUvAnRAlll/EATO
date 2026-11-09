import { useState } from "react";
import { Keyboard, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { OpeningHoursEditor } from "@/components/gym/OpeningHoursEditor";
import { OptionChip, RegisterFrame, WithApplication } from "@/components/gymRegister/RegisterParts";
import { ABOUT_MAX, FACILITIES, hoursProblem, startingHours, type FacilityId, type OpeningHours } from "@/lib/gymProfile";
import { orNull, registrationApi, type Application } from "@/lib/gymRegistration";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useGymRegistration } from "@/store/gymRegistration";
import { fonts } from "@/constants/fonts";
import { useThemeColors } from "@/theme";

// Register your gym › About the gym: a short description, the facilities and the opening hours.
// They become the gym's draft public profile, which the gym admin publishes once approved.
export default function RegisterAboutGym() {
  return <WithApplication title="About the gym" render={(app) => <GymForm app={app} />} />;
}

function GymForm({ app }: { app: Application }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const put = useGymRegistration((state) => state.put);
  const [about, setAbout] = useState(app.about ?? "");
  const [facilities, setFacilities] = useState<FacilityId[]>(app.facilities);
  const [hours, setHours] = useState<OpeningHours>(app.hours ?? startingHours());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: FacilityId) => setFacilities((list) => (list.includes(id) ? list.filter((f) => f !== id) : FACILITIES.map((f) => f.id).filter((f) => f === id || list.includes(f))));

  const save = async () => {
    if (busy) return;
    Keyboard.dismiss();
    const problem = hoursProblem(hours);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const answer = await registrationApi.edit(await getToken().catch(() => null), app.id, { about: orNull(about), facilities, hours });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    put(answer.data);
    hud.success("Saved");
    router.back();
  };

  return (
    <RegisterFrame title="About the gym" action={<PrimaryButton label="Save" onPress={save} loading={busy} />}>
      <Text className="setup__section">Description</Text>
      <View className="setup__field" style={{ alignItems: "flex-start" }}>
        <TextInput
          value={about}
          onChangeText={(t) => setAbout(t.slice(0, ABOUT_MAX))}
          placeholder="What members should know: training areas, equipment, coaching, the crowd…"
          placeholderTextColor={colors.faint}
          multiline
          maxLength={ABOUT_MAX}
          style={{ flex: 1, minHeight: 96, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, textAlignVertical: "top" }}
          accessibilityLabel="Description"
        />
      </View>
      <Text className="type-caption text-muted self-end">{about.length}/{ABOUT_MAX}</Text>

      <Text className="setup__section mt-2">Facilities</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {FACILITIES.map((f) => <OptionChip key={f.id} label={f.label} on={facilities.includes(f.id)} onPress={() => toggle(f.id)} />)}
      </View>

      <Text className="setup__section mt-2">Opening hours</Text>
      <View className="card">
        <OpeningHoursEditor hours={hours} onChange={setHours} />
      </View>
      {error ? <FormAlert message={error} /> : null}
    </RegisterFrame>
  );
}
