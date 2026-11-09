import { useState } from "react";
import { Keyboard, Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SetupField } from "@/components/setup/SetupField";
import { OptionChip, RegisterFrame, WithApplication } from "@/components/gymRegister/RegisterParts";
import { findMe } from "@/lib/deliveryLocation";
import { STATES, orNull, registrationApi, type Application } from "@/lib/gymRegistration";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useGymRegistration } from "@/store/gymRegistration";

// Register your gym › Location: the full address members will visit, and the gym's place on the map
// (taken from the phone's location while standing at the gym; it can be set later in the portal)
export default function RegisterLocation() {
  return <WithApplication title="Location" render={(app) => <LocationForm app={app} />} />;
}

function LocationForm({ app }: { app: Application }) {
  const getToken = useSessionToken();
  const put = useGymRegistration((state) => state.put);
  const [address, setAddress] = useState(app.address ?? "");
  const [area, setArea] = useState(app.area);
  const [city, setCity] = useState(app.city);
  const [state, setState] = useState(app.state ?? "");
  const [pincode, setPincode] = useState(app.pincode ?? "");
  const [place, setPlace] = useState(app.latitude !== null && app.longitude !== null ? { latitude: app.latitude, longitude: app.longitude } : null);
  const [showStates, setShowStates] = useState(false);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinBad = pincode.length === 6 && !/^[1-9]\d{5}$/.test(pincode);

  const useHere = async () => {
    setLocating(true);
    setError(null);
    const found = await findMe();
    setLocating(false);
    if (!found.ok) return setError(found.message);
    setPlace({ latitude: found.at.latitude, longitude: found.at.longitude });
    hud.success("Location added");
  };

  const save = async () => {
    if (busy) return;
    Keyboard.dismiss();
    if (area.trim().length < 2 || city.trim().length < 2) return setError("Enter the area and the city.");
    if (pincode && !/^[1-9]\d{5}$/.test(pincode)) return setError("Enter a 6-digit pincode.");
    setBusy(true);
    setError(null);
    const answer = await registrationApi.edit(await getToken().catch(() => null), app.id, {
      address: orNull(address), area: area.trim(), city: city.trim(), state: orNull(state), pincode: orNull(pincode),
      latitude: place?.latitude ?? null, longitude: place?.longitude ?? null,
    });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    put(answer.data);
    hud.success("Saved");
    router.back();
  };

  return (
    <RegisterFrame title="Location" action={<PrimaryButton label="Save" onPress={save} loading={busy} />}>
      <SetupField label="Building, street and landmark" icon={{ ios: "building.2", android: "location_city", web: "location_city" }} value={address} onChangeText={(t) => setAddress(t.slice(0, 160))} placeholder="2nd floor, 12, 80 Feet Road, near Metro" autoCapitalize="sentences" maxLength={160} />
      <SetupField label="Area" icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} value={area} onChangeText={(t) => setArea(t.slice(0, 80))} placeholder="Indiranagar" autoCapitalize="words" maxLength={80} />
      <View className="flex-row" style={{ gap: 12 }}>
        <View className="flex-1">
          <SetupField label="City" icon={{ ios: "map", android: "map", web: "map" }} value={city} onChangeText={(t) => setCity(t.slice(0, 60))} placeholder="Bengaluru" autoCapitalize="words" maxLength={60} />
        </View>
        <View className="flex-1">
          <SetupField label="Pincode" icon={{ ios: "number", android: "pin", web: "pin" }} value={pincode} onChangeText={(t) => setPincode(t.replace(/\D/g, "").slice(0, 6))} placeholder="560038" keyboardType="number-pad" textContentType="postalCode" maxLength={6} invalid={pinBad} />
        </View>
      </View>
      <SetupField label="State" icon={{ ios: "flag", android: "flag", web: "flag" }} value={state} placeholder="Pick the state" onPress={() => setShowStates((s) => !s)} />
      {showStates ? (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {STATES.map((s) => <OptionChip key={s} label={s} on={state === s} onPress={() => { setState(s); setShowStates(false); }} />)}
        </View>
      ) : null}

      <Text className="setup__section mt-2">Place on the map (optional)</Text>
      <View className="card" style={{ gap: 10 }}>
        <Text className="type-body text-muted">
          {place ? `Saved: ${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}` : "Standing at the gym? Add its place so members can find it and check in with the QR code. You can also set it later in the gym portal."}
        </Text>
        <PrimaryButton label={place ? "Use my current location again" : "Use my current location"} onPress={useHere} loading={locating} />
      </View>
      {error ? <FormAlert message={error} /> : null}
    </RegisterFrame>
  );
}
