import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Linking, Platform, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Redirect, router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { SetupField } from "@/components/setup/SetupField";
import { KIND_ICON } from "@/data/addresses";
import { canPickContact, pickContact } from "@/lib/contactPicker";
import { addressApi, type DeliveryAddress, type Serviceable } from "@/lib/addressApi";
import { KINDS, KIND_LABEL, PINCODE, formProblem, phoneDigits, phoneText, type AddressForm, type AddressKind, type PickedPlace } from "@/lib/addressRules";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { confirmChoice, showActions } from "@/lib/nativeSheets";
import { useAddressBook } from "@/lib/useAddressBook";
import { useAddressDraft } from "@/store/addressDraft";
import { useAuthStore } from "@/store/auth";
import { useSwitchColors, useThemeColors } from "@/theme";

const EMPTY: AddressForm = { receiverName: "", receiverPhone: "", house: "", street: "", landmark: "", city: "", pincode: "", instructions: "" };

// Add Delivery Address (after Confirm Location) and Edit (?id=): who receives it, the house or
// flat, the street and area, an optional landmark, the pincode (checked against where justFit
// delivers), the type and optional instructions. The map's pin is shown at the top and is only a
// starting point: the address is what is typed here. Save stays pinned above the keyboard.
export default function AddressFormScreen() {
  // from=map: a new address picked on the map, which sits under this form
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const editId = id && /^[1-9][0-9]*$/.test(id) ? Number(id) : null;
  const user = useAuthStore((state) => state.user);
  const draft = useAddressDraft((state) => state.place);
  const { load, getToken } = useAddressBook();
  const saved = editId && load.state === "ready" ? load.book.addresses.find((a) => a.id === editId) ?? null : null;

  // A new address needs a place from the map first
  if (!editId && !draft) return <Redirect href="/addresses/location" />;

  const frame = (body: ReactNode) => (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title={editId ? "Edit address" : "Add address details"} fallback="/addresses" />
        {body}
      </SafeAreaView>
    </View>
  );
  if (editId && load.state === "loading") return frame(<View className="p-4"><ScreenSkeleton cards={3} label="Loading the address" /></View>);
  if (editId && !saved) {
    return frame(
      <View className="p-4">
        <View className="card" style={{ gap: 12 }}>
          <FormAlert message={load.state === "failed" ? load.error : "That address isn't saved on your account."} />
          <PrimaryButton label="Back to my addresses" onPress={() => router.dismissTo("/addresses")} />
        </View>
      </View>,
    );
  }

  // Filled in from the saved address (an edit), else from the account and the map's place
  const initial: Initial = saved
    ? {
        form: { receiverName: saved.receiverName, receiverPhone: saved.receiverPhone, house: saved.house, street: saved.street, landmark: saved.landmark ?? "", city: saved.city ?? "", pincode: saved.pincode, instructions: saved.instructions ?? "" },
        kind: saved.kind,
        makeDefault: saved.isDefault,
      }
    : {
        form: { ...EMPTY, receiverName: user?.fullName?.trim() ?? "", receiverPhone: phoneDigits(user?.phone ?? ""), street: draft?.street ?? "", city: draft?.city ?? "", pincode: draft?.pincode ?? "" },
        kind: "home",
        makeDefault: true,
      };
  return frame(<AddressFormBody editId={editId} saved={saved} initial={initial} getToken={getToken} fromMap={from === "map"} />);
}

type Initial = { form: AddressForm; kind: AddressKind; makeDefault: boolean };

function AddressFormBody({ editId, saved, initial, getToken, fromMap }: { editId: number | null; saved: DeliveryAddress | null; initial: Initial; getToken: () => Promise<string | null>; fromMap: boolean }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const insets = useSafeAreaInsets();
  const draft = useAddressDraft((state) => state.place);
  // The pin: a place just picked on the map, else the saved address's own
  const place: PickedPlace | null = draft ?? (saved ? { latitude: saved.latitude, longitude: saved.longitude, title: KIND_LABEL[saved.kind], formattedAddress: saved.formattedAddress, street: saved.street, city: saved.city ?? "", pincode: saved.pincode } : null);

  const [form, setForm] = useState<AddressForm>(initial.form);
  const [kind, setKind] = useState<AddressKind>(initial.kind);
  const [makeDefault, setMakeDefault] = useState(initial.makeDefault);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The last delivery answer, for the pincode it was asked about ("checking" while it differs)
  const [service, setService] = useState<Serviceable | null>(null);
  const keyboardUp = useKeyboardUp();

  // A place picked again on the map (Change) brings its street, city and pincode
  const [seenDraft, setSeenDraft] = useState(draft);
  if (draft !== seenDraft) {
    setSeenDraft(draft);
    if (draft) setForm((f) => ({ ...f, street: draft.street || f.street, city: draft.city || f.city, pincode: draft.pincode || f.pincode }));
  }

  // Whether justFit delivers to the pincode, asked once it has 6 digits
  const pincodeReady = PINCODE.test(form.pincode);
  useEffect(() => {
    if (!pincodeReady) return;
    let live = true;
    const timer = setTimeout(async () => {
      const answer = await addressApi.serviceable(await getToken().catch(() => null), form.pincode);
      if (live && answer.ok) setService(answer.data);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [form.pincode, pincodeReady, getToken]);
  const serviceShown: Serviceable | "checking" | null = !pincodeReady ? null : service?.pincode === form.pincode ? service : "checking";

  const set = (key: keyof AddressForm) => (text: string) => setForm((f) => ({ ...f, [key]: text }));
  const problem = formProblem(form);

  const save = async () => {
    if (!place || problem || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    const fields = {
      kind,
      receiverName: form.receiverName.trim(),
      receiverPhone: form.receiverPhone,
      house: form.house.trim(),
      street: form.street.trim(),
      landmark: form.landmark.trim(),
      city: form.city.trim(),
      pincode: form.pincode,
      formattedAddress: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude,
      instructions: form.instructions.trim(),
      makeDefault,
    };
    const token = await getToken().catch(() => null);
    const answer = editId ? await addressApi.update(token, editId, fields) : await addressApi.create(token, fields);
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    // The draft stays until the next add or edit starts (clearing it here would send this screen
    // back to the map before it closes)
    hud.success(editId ? "Address updated" : "Address saved");
    leaveAfterSave();
  };

  // Back to where the member started: a new address closes the form and the map under it (the
  // saved list, the Meals tab or the cart, which read the book again when they show), so Back
  // never lands on the map again; an edit closes the form. Opened with nothing behind it (a
  // link or a reload), the saved list replaces it.
  const leaveAfterSave = () => {
    if (!router.canGoBack()) return router.replace("/addresses");
    if (!editId && fromMap) return router.dismiss(2);
    router.back();
  };

  // Receiver from the phone's contacts: the name, and the number (asked when there are several)
  const picking = useRef(false);
  const fromContacts = async () => {
    if (picking.current) return;
    picking.current = true;
    Keyboard.dismiss();
    const pick = await pickContact();
    picking.current = false;
    if (pick.kind === "cancelled") return;
    if (pick.kind === "failed") return hud.error("Couldn't open your contacts");
    if (pick.kind === "denied") {
      const open = await confirmChoice({ title: "Contacts are off", message: "Allow justFit to read your contacts in Settings to pick a receiver from them.", confirmLabel: "Open Settings", destructive: false });
      if (open) Linking.openSettings().catch(() => {});
      return;
    }
    const { name, mobiles } = pick.contact;
    const fill = (digits: string | null) => {
      haptic.select();
      setForm((f) => ({ ...f, receiverName: name || f.receiverName, receiverPhone: digits ?? f.receiverPhone }));
    };
    if (mobiles.length === 0) {
      fill(null);
      return hud.error("No Indian mobile number on that contact");
    }
    if (mobiles.length === 1) return fill(mobiles[0].digits);
    showActions({
      title: name || "Pick a number",
      message: "Which number takes the delivery?",
      actions: mobiles.map((m) => ({ label: m.label ? `${phoneText(m.digits)} · ${m.label}` : phoneText(m.digits), onPress: () => fill(m.digits) })),
    });
  };

  const changePin = () => {
    // A new address came from the map: back to it. An edit opens the map on its own pin.
    if (!editId && router.canGoBack()) return router.back();
    router.push({ pathname: "/addresses/location", params: { then: "back", ...(place ? { lat: String(place.latitude), lng: String(place.longitude) } : {}) } });
  };

  return (
    <KeyboardAvoider>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
      >
        {place && (
          <View className="card flex-row items-start" style={{ gap: 12 }}>
            <View className="address-kind address-kind--selected">
              <SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={18} tintColor={colors.leaf} />
            </View>
            <View className="min-w-0 flex-1" style={{ gap: 2 }}>
              <Text className="card__title" numberOfLines={1}>{place.title}</Text>
              <Text className="type-caption text-muted" numberOfLines={2}>{place.formattedAddress}</Text>
            </View>
            <PressableScale onPress={changePin} className="address-action" accessibilityRole="button" accessibilityLabel="Change the pin on the map">
              <Text className="address-action__label" style={{ color: colors.primaryText }}>Change</Text>
            </PressableScale>
          </View>
        )}

        <View className="mt-2 flex-row items-center justify-between" style={{ gap: 12 }}>
          <Text className="setup__section">Receiver</Text>
          {canPickContact && (
            <PressableScale onPress={fromContacts} className="address-action" accessibilityRole="button" accessibilityLabel="Pick the receiver from your contacts">
              <SymbolView name={{ ios: "person.crop.circle", android: "contacts", web: "contacts" }} size={16} tintColor={colors.primaryText} />
              <Text className="address-action__label" style={{ color: colors.primaryText }}>From contacts</Text>
            </PressableScale>
          )}
        </View>
        <SetupField label="Receiver's name" icon={{ ios: "person", android: "person", web: "person" }} value={form.receiverName} onChangeText={(t) => set("receiverName")(t.slice(0, 60))} placeholder="Who takes the delivery" autoCapitalize="words" textContentType="name" autoComplete="name" maxLength={60} />
        <SetupField label="Mobile number" icon={{ ios: "phone", android: "call", web: "call" }} prefix="+91" value={form.receiverPhone} onChangeText={(t) => set("receiverPhone")(phoneDigits(t))} placeholder="10-digit mobile number" keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" maxLength={14} invalid={form.receiverPhone.length === 10 && !/^[6-9]/.test(form.receiverPhone)} />

        <Text className="setup__section mt-2">Address</Text>
        <SetupField label="House, flat, building" icon={{ ios: "building.2", android: "location_city", web: "location_city" }} value={form.house} onChangeText={(t) => set("house")(t.slice(0, 120))} placeholder="Flat 4B, Sai Residency" autoCapitalize="words" maxLength={120} />
        <SetupField label="Apartment, street and area" icon={{ ios: "signpost.right", android: "signpost", web: "signpost" }} value={form.street} onChangeText={(t) => set("street")(t.slice(0, 160))} placeholder="MG Road, Batawadi" autoCapitalize="words" maxLength={160} />
        <SetupField label="Nearby landmark (optional)" icon={{ ios: "flag", android: "flag", web: "flag" }} value={form.landmark} onChangeText={(t) => set("landmark")(t.slice(0, 120))} placeholder="Opposite SIT college" autoCapitalize="sentences" maxLength={120} />
        <View className="flex-row" style={{ gap: 12 }}>
          <View className="flex-1">
            <SetupField label="City" icon={{ ios: "map", android: "map", web: "map" }} value={form.city} onChangeText={(t) => set("city")(t.slice(0, 80))} placeholder="Tumakuru" autoCapitalize="words" maxLength={80} />
          </View>
          <View className="flex-1">
            <SetupField label="Pincode" icon={{ ios: "number", android: "pin", web: "pin" }} value={form.pincode} onChangeText={(t) => set("pincode")(t.replace(/\D/g, "").slice(0, 6))} placeholder="572103" keyboardType="number-pad" textContentType="postalCode" autoComplete="postal-code" maxLength={6} invalid={form.pincode.length === 6 && !PINCODE.test(form.pincode)} />
          </View>
        </View>
        <ServiceLine service={serviceShown} />

        <Text className="setup__section mt-2">Save as</Text>
        <View className="flex-row" style={{ gap: 8 }} accessibilityRole="radiogroup">
          {KINDS.map((k) => {
            const on = kind === k;
            return (
              <PressableScale key={k} onPress={() => { if (!on) haptic.select(); setKind(k); }} className={on ? "setup__chip setup__chip--selected flex-row" : "setup__chip flex-row"} style={{ gap: 6 }} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={KIND_LABEL[k]}>
                <SymbolView name={KIND_ICON[k]} size={14} tintColor={on ? colors.leaf : colors.inkSoft} />
                <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{KIND_LABEL[k]}</Text>
              </PressableScale>
            );
          })}
        </View>

        <SetupField label="Delivery instructions (optional)" icon={{ ios: "text.bubble", android: "chat", web: "chat" }} value={form.instructions} onChangeText={(t) => set("instructions")(t.slice(0, 200))} placeholder="Ring the bell, leave at the gate…" multiline maxLength={200} />

        {!(saved?.isDefault) && (
          <View className="card flex-row items-center" style={{ gap: 12 }}>
            <View className="min-w-0 flex-1">
              <Text className="card__title">Deliver to this address</Text>
              <Text className="type-caption text-muted">Use it for your next orders</Text>
            </View>
            <Switch value={makeDefault} onValueChange={(v) => { haptic.select(); setMakeDefault(v); }} {...switchColors} accessibilityLabel="Deliver to this address" />
          </View>
        )}

        {error && <FormAlert message={error} />}
      </ScrollView>

      <View className="address-footer" style={{ paddingBottom: keyboardUp ? 12 : insets.bottom + 12 }}>
        {problem && (form.receiverName || form.house) ? <Text className="type-caption text-muted text-center mb-2">{problem}</Text> : null}
        <PrimaryButton label={editId ? "Save Changes" : "Save Address"} onPress={save} loading={busy} disabled={!!problem || !place} />
      </View>
    </KeyboardAvoider>
  );
}

// Under the pincode: whether justFit delivers there (an address is saved either way)
function ServiceLine({ service }: { service: Serviceable | "checking" | null }) {
  const colors = useThemeColors();
  if (service === null) return null;
  if (service === "checking") return <Text className="type-caption text-muted">Checking delivery…</Text>;
  return service.deliverable ? (
    <View className="address-tag address-tag--success">
      <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={12} tintColor={colors.success} />
      <Text className="address-tag__label" style={{ color: colors.success }}>{`justFit delivers to ${service.pincode}${service.area ? ` · ${service.area}` : ""}`}</Text>
    </View>
  ) : (
    <View className="address-tag address-tag--warning">
      <SymbolView name={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }} size={12} tintColor={colors.warning} />
      <Text className="address-tag__label" style={{ color: colors.warning }}>{`Not delivering to ${service.pincode} yet. You can still save it.`}</Text>
    </View>
  );
}

// Whether the keyboard is up (the pinned Save then sits right on it, without the home indicator's room)
function useKeyboardUp() {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setUp(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return up;
}
