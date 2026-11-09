import { useState } from "react";
import { Keyboard, Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SetupField } from "@/components/setup/SetupField";
import { OptionChip, RegisterFrame, WithApplication } from "@/components/gymRegister/RegisterParts";
import { BUSINESS_TYPES, orNull, registrationApi, type Application, type BusinessType } from "@/lib/gymRegistration";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useGymRegistration } from "@/store/gymRegistration";

const digits = (text: string) => text.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").slice(0, 10);

// Register your gym › Business and contact: the gym's name, the business behind it and who justFit
// should call about the application
export default function RegisterBusiness() {
  return <WithApplication title="Business and contact" render={(app) => <BusinessForm app={app} />} />;
}

function BusinessForm({ app }: { app: Application }) {
  const getToken = useSessionToken();
  const put = useGymRegistration((state) => state.put);
  const [gymName, setGymName] = useState(app.gymName);
  const [legalName, setLegalName] = useState(app.legalName ?? "");
  const [type, setType] = useState<BusinessType | null>(app.businessType);
  const [contactName, setContactName] = useState(app.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(app.contactPhone ?? "");
  const [contactEmail, setContactEmail] = useState(app.contactEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneBad = contactPhone.length > 0 && !/^[6-9]\d{9}$/.test(contactPhone);

  const save = async () => {
    if (busy) return;
    Keyboard.dismiss();
    if (gymName.trim().length < 2) return setError("Enter the gym's name.");
    if (phoneBad) return setError("Enter a 10-digit mobile number.");
    setBusy(true);
    setError(null);
    const answer = await registrationApi.edit(await getToken().catch(() => null), app.id, {
      gymName: gymName.trim(), legalName: orNull(legalName), businessType: type, contactName: orNull(contactName), contactPhone: orNull(contactPhone), contactEmail: orNull(contactEmail),
    });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    put(answer.data);
    hud.success("Saved");
    router.back();
  };

  return (
    <RegisterFrame title="Business and contact" action={<PrimaryButton label="Save" onPress={save} loading={busy} />}>
      <Text className="setup__section">The gym</Text>
      <SetupField label="Gym name (members see this)" icon={{ ios: "dumbbell", android: "fitness_center", web: "fitness_center" }} value={gymName} onChangeText={(t) => setGymName(t.slice(0, 80))} placeholder="Iron House Fitness" autoCapitalize="words" maxLength={80} />
      <SetupField label="Registered business name (optional)" icon={{ ios: "building.2", android: "business", web: "business" }} value={legalName} onChangeText={(t) => setLegalName(t.slice(0, 120))} placeholder="Iron House Fitness LLP" autoCapitalize="words" maxLength={120} />
      <Text className="setup__section mt-2">Type of business</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {BUSINESS_TYPES.map((b) => <OptionChip key={b.id} label={b.label} on={type === b.id} onPress={() => setType(b.id)} />)}
      </View>
      <Text className="setup__section mt-2">Who we should contact</Text>
      <SetupField label="Contact person" icon={{ ios: "person", android: "person", web: "person" }} value={contactName} onChangeText={(t) => setContactName(t.slice(0, 80))} placeholder="Full name" autoCapitalize="words" textContentType="name" maxLength={80} />
      <SetupField label="Mobile number" icon={{ ios: "phone", android: "call", web: "call" }} prefix="+91" value={contactPhone} onChangeText={(t) => setContactPhone(digits(t))} placeholder="10-digit mobile number" keyboardType="phone-pad" textContentType="telephoneNumber" maxLength={14} invalid={phoneBad} />
      <SetupField label="Email (optional)" icon={{ ios: "envelope", android: "mail", web: "mail" }} value={contactEmail} onChangeText={(t) => setContactEmail(t.slice(0, 120))} placeholder="owner@gym.in" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" maxLength={120} />
      <Text className="type-caption text-muted">Only the justFit team sees these contact details.</Text>
      {error ? <FormAlert message={error} /> : null}
    </RegisterFrame>
  );
}
