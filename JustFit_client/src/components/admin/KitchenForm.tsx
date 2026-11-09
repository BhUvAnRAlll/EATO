import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";

import { AdminField } from "@/components/admin/AdminField";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { SymbolView } from "@/components/SymbolView";
import { findMe } from "@/lib/deliveryLocation";
import { pickCatalogImage, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import type { Day } from "@/lib/gymProfile";
import { DAY_SHORT, WEEK, hoursFrom, hoursProblem, hoursToForm, parsePincodes } from "@/lib/kitchenRules";
import type { Kitchen, KitchenInput } from "@/lib/kitchensApi";
import { mealImage } from "@/lib/mealsApi";
import { showActions } from "@/lib/nativeSheets";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

const digits = (text: string) => text.replace(/[^0-9]/g, "");
const asText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

type KitchenFormProps = {
  kitchen?: Kitchen; // editing this kitchen; a new one when left out
  busy: boolean;
  error: string;
  saveLabel: string;
  onSave: (input: KitchenInput) => void;
};

// Super Admin › Kitchens › Add kitchen and a kitchen's Edit: the photo, name, contact person and
// number, email, address (area, city, pincode, and the map point from this phone's location),
// opening hours (one time for the open days, and the closed days), the pincodes it serves, and its
// capacity (orders a day, meals a meal time, delivery radius). The server checks it all again.
export function KitchenForm({ kitchen, busy, error, saveLabel, onSave }: KitchenFormProps) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const start = hoursToForm(kitchen?.hours);
  const [photo, setPhoto] = useState<MemberPhoto | null>(null);
  const [removed, setRemoved] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [name, setName] = useState(kitchen?.name ?? "");
  const [contactName, setContactName] = useState(kitchen?.contactName ?? "");
  const [phone, setPhone] = useState(kitchen?.phone ?? "");
  const [email, setEmail] = useState(kitchen?.email ?? "");
  const [address, setAddress] = useState(kitchen?.address ?? "");
  const [area, setArea] = useState(kitchen?.area ?? "");
  const [city, setCity] = useState(kitchen?.city ?? "");
  const [pincode, setPincode] = useState(kitchen?.pincode ?? "");
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(
    kitchen?.latitude != null && kitchen?.longitude != null ? { latitude: kitchen.latitude, longitude: kitchen.longitude } : null,
  );
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [opens, setOpens] = useState(start.opens);
  const [closes, setCloses] = useState(start.closes);
  const [closed, setClosed] = useState<Day[]>(start.closed);
  const [pincodesText, setPincodesText] = useState((kitchen?.pincodes ?? []).join(", "));
  const [maxDaily, setMaxDaily] = useState(asText(kitchen?.maxDailyOrders));
  const [prep, setPrep] = useState(asText(kitchen?.prepCapacity));
  const [radius, setRadius] = useState(asText(kitchen?.radiusKm));

  const hasPhoto = !!photo || (!!kitchen?.photoUrl && !removed);
  const choosePhoto = () => {
    const pick = async (source: PhotoSource) => {
      setPhotoError("");
      const picked = await pickCatalogImage(source);
      if (picked.ok) {
        setPhoto(picked.photo);
        setRemoved(false);
      } else if (!("cancelled" in picked)) setPhotoError(picked.error);
    };
    showActions({
      title: "Kitchen photo",
      actions: [
        ...(Platform.OS === "web" ? [] : [{ label: "Take photo", onPress: () => pick("camera") }]),
        { label: "Choose from gallery", onPress: () => pick("library") },
        ...(hasPhoto ? [{ label: "Remove photo", destructive: true, onPress: () => { setPhoto(null); setRemoved(true); } }] : []),
      ],
    });
  };
  const locate = async () => {
    if (locating) return;
    setLocating(true);
    setLocationError("");
    const found = await findMe();
    setLocating(false);
    if (found.ok) setPoint({ latitude: found.at.latitude, longitude: found.at.longitude });
    else setLocationError(found.message);
  };

  const pins = parsePincodes(pincodesText);
  const timeProblem = hoursProblem(opens, closes, closed);
  const radiusKm = Number(radius);
  const numbers = { maxDaily: Number(maxDaily), prep: Number(prep) };
  const ready =
    name.trim().length >= 2 && contactName.trim().length >= 2 && digits(phone).length === 10 && address.trim().length >= 5 && city.trim().length >= 2 &&
    /^[1-9][0-9]{5}$/.test(pincode) && !!pins && !timeProblem && numbers.maxDaily >= 1 && numbers.prep >= 1 && radius !== "" && radiusKm >= 0.5 && radiusKm <= 50;

  const submit = () => {
    if (!ready || busy || !pins) return;
    onSave({
      name: name.trim(),
      contactName: contactName.trim(),
      phone: digits(phone),
      email: email.trim() || null,
      address: address.trim(),
      area: area.trim() || null,
      city: city.trim(),
      pincode,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      hours: hoursFrom(opens, closes, closed),
      pincodes: pins,
      maxDailyOrders: Math.round(numbers.maxDaily),
      prepCapacity: Math.round(numbers.prep),
      radiusKm,
      ...(photo ? { photo: { data: photo.data, mediaType: photo.mediaType } } : removed && kitchen?.photoUrl ? { removePhoto: true as const } : {}),
    });
  };

  return (
    <KeyboardAvoider>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
        <Pressable onPress={choosePhoto} className="meal__card items-center justify-center" style={{ aspectRatio: 16 / 9, backgroundColor: hasPhoto ? colors.surface : colors.creamDeep }} accessibilityRole="button" accessibilityLabel={hasPhoto ? "Change the kitchen photo" : "Add a kitchen photo"}>
          {photo ? (
            <Image source={{ uri: photo.previewUri }} contentFit="cover" style={{ width: "100%", height: "100%" }} />
          ) : hasPhoto && kitchen ? (
            <Image source={mealImage(kitchen.photoUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} />
          ) : (
            <View className="items-center" style={{ gap: 6 }}>
              <SymbolView name={{ ios: "camera.fill", android: "photo_camera", web: "photo_camera" }} size={28} tintColor={colors.muted} />
              <Text className="card__title">Add a photo (optional)</Text>
              <Text className="meta-text">{"The kitchen's front or its cooking area"}</Text>
            </View>
          )}
        </Pressable>
        {photoError ? <FormAlert message={photoError} /> : null}

        <Text className="type-headline text-forest-ink">Kitchen</Text>
        <AdminField label="Kitchen name" value={name} onChangeText={setName} maxLength={80} placeholder="For example: Koramangala Kitchen" />
        <AdminField label="Contact person" value={contactName} onChangeText={setContactName} maxLength={60} placeholder="For example: Suresh Rao" />
        <AdminField label="Phone number" value={phone} onChangeText={(t) => setPhone(digits(t).slice(0, 10))} keyboardType="number-pad" maxLength={10} placeholder="10-digit mobile number" />
        <AdminField label="Email (optional)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" maxLength={120} placeholder="kitchen@example.com" />

        <Text className="type-headline text-forest-ink">Address</Text>
        <AdminField label="Address" value={address} onChangeText={setAddress} maxLength={200} multiline placeholder="Building, street" />
        <View className="flex-row" style={{ gap: 10 }}>
          <View className="flex-1"><AdminField label="Area (optional)" value={area} onChangeText={setArea} maxLength={60} placeholder="Koramangala" /></View>
          <View className="flex-1"><AdminField label="City" value={city} onChangeText={setCity} maxLength={40} placeholder="Bengaluru" /></View>
        </View>
        <AdminField label="Pincode" value={pincode} onChangeText={(t) => setPincode(digits(t).slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="560095" />
        <View className="card flex-row items-center" style={{ gap: 12 }}>
          <View className="flex-1">
            <Text className="card__title">Map point (optional)</Text>
            <Text className="meta-text">{point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : "Stand in the kitchen and use this phone's location."}</Text>
          </View>
          <Pressable onPress={locate} disabled={locating} className="admin-chip flex-row" style={{ gap: 6 }} accessibilityRole="button">
            {locating ? <ActivityIndicator size="small" color={colors.leaf} /> : <SymbolView name={{ ios: "location.fill", android: "my_location", web: "my_location" }} size={14} tintColor={colors.leaf} />}
            <Text className="admin-segment__label admin-segment__label--on">{point ? "Update" : "Use location"}</Text>
          </Pressable>
        </View>
        {locationError ? <FormAlert message={locationError} /> : null}

        <Text className="type-headline text-forest-ink">Opening hours</Text>
        <View className="flex-row" style={{ gap: 10 }}>
          <View className="flex-1"><AdminField label="Opens" value={opens} onChangeText={setOpens} maxLength={5} placeholder="06:00" keyboardType="numbers-and-punctuation" /></View>
          <View className="flex-1"><AdminField label="Closes" value={closes} onChangeText={setCloses} maxLength={5} placeholder="22:00" keyboardType="numbers-and-punctuation" /></View>
        </View>
        <View className="gap-1.5">
          <Text className="auth__label">Closed on</Text>
          <View className="flex-row flex-wrap gap-2">
            {WEEK.map((d) => {
              const on = closed.includes(d);
              return (
                <Pressable key={d} onPress={() => setClosed(on ? closed.filter((x) => x !== d) : [...closed, d])} className={on ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Closed on ${DAY_SHORT[d]}`}>
                  <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{DAY_SHORT[d]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {timeProblem ? <Text className="admin__hint" style={{ color: colors.danger }}>{timeProblem}</Text> : null}

        <Text className="type-headline text-forest-ink">Delivery and capacity</Text>
        <AdminField
          label="Pincodes it delivers to"
          value={pincodesText}
          onChangeText={setPincodesText}
          multiline
          maxLength={800}
          keyboardType="numbers-and-punctuation"
          placeholder="560095, 560034, 560047"
          hint={pins ? `${pins.length} ${pins.length === 1 ? "pincode" : "pincodes"}` : "Six-digit pincodes, separated by commas or spaces."}
        />
        <View className="flex-row" style={{ gap: 10 }}>
          <View className="flex-1"><AdminField label="Orders a day" value={maxDaily} onChangeText={(t) => setMaxDaily(digits(t))} keyboardType="number-pad" maxLength={4} placeholder="400" /></View>
          <View className="flex-1"><AdminField label="Meals a meal time" value={prep} onChangeText={(t) => setPrep(digits(t))} keyboardType="number-pad" maxLength={4} placeholder="120" /></View>
        </View>
        <AdminField label="Delivery radius (km)" value={radius} onChangeText={(t) => setRadius(t.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))} keyboardType="decimal-pad" maxLength={4} placeholder="6" hint="From 0.5 to 50 km." />

        {error ? <FormAlert message={error} /> : null}
        <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel={saveLabel}>
          {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
          <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{saveLabel}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoider>
  );
}
