import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { ID_STATUS_LABEL, VEHICLE_LABEL } from "@/data/delivery";
import type { IdStatus, Partner, PartnerInput, Vehicle } from "@/lib/deliveryApi";
import { parsePincodes } from "@/lib/kitchenRules";
import { useSwitchColors, useThemeColors } from "@/theme";

const VEHICLES = (Object.keys(VEHICLE_LABEL) as Vehicle[]).map((value) => ({ value, label: VEHICLE_LABEL[value] }));
const ID_STATUSES = (Object.keys(ID_STATUS_LABEL) as IdStatus[]).map((value) => ({ value, label: ID_STATUS_LABEL[value] }));
const digits = (t: string) => t.replace(/[^0-9]/g, "");

// Super Admin › Delivery › Add partner and a partner's Edit (Meal Operations phase 4): name, number,
// vehicle and its number, the ID check (only verified partners get orders), how many orders they
// carry at once, the pincodes they cover, active and available, a note.
export function PartnerForm({ partner, busy, error, saveLabel, onSave }: { partner?: Partner; busy: boolean; error: string; saveLabel: string; onSave: (input: PartnerInput) => void }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [name, setName] = useState(partner?.name ?? "");
  const [phone, setPhone] = useState(partner?.phone ?? "");
  const [vehicle, setVehicle] = useState<Vehicle>(partner?.vehicle ?? "bike");
  const [vehicleNumber, setVehicleNumber] = useState(partner?.vehicleNumber ?? "");
  const [idStatus, setIdStatus] = useState<IdStatus>(partner?.idStatus ?? "pending");
  const [maxOrders, setMaxOrders] = useState(String(partner?.maxOrders ?? 3));
  const [pincodes, setPincodes] = useState((partner?.pincodes ?? []).join(", "));
  const [active, setActive] = useState(partner?.active ?? true);
  const [available, setAvailable] = useState(partner?.available ?? true);
  const [note, setNote] = useState(partner?.note ?? "");
  const pins = parsePincodes(pincodes);
  const max = Number(maxOrders);
  const ready = name.trim().length >= 2 && phone.length === 10 && !!pins && Number.isInteger(max) && max >= 1 && max <= 10;

  const submit = () => {
    if (!ready || busy || !pins) return;
    onSave({ name: name.trim(), phone, vehicle, vehicleNumber: vehicleNumber.trim() || null, idStatus, maxOrders: max, pincodes: pins, active, available, note: note.trim() || null });
  };

  return (
    <KeyboardAvoider>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
        <AdminField label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="For example: Ravi Kumar" />
        <AdminField label="Mobile number" value={phone} onChangeText={(t) => setPhone(digits(t).slice(0, 10))} keyboardType="number-pad" maxLength={10} placeholder="10 digits" />
        <ChoiceChips label="Vehicle" options={VEHICLES} value={vehicle} onChange={setVehicle} />
        {vehicle !== "on_foot" && vehicle !== "bicycle" ? (
          <AdminField label="Vehicle number (optional)" value={vehicleNumber} onChangeText={setVehicleNumber} autoCapitalize="characters" maxLength={16} placeholder="KA 01 AB 1234" />
        ) : null}
        <ChoiceChips label="ID check" options={ID_STATUSES} value={idStatus} onChange={setIdStatus} />
        {idStatus !== "verified" ? <Text className="admin__hint">Only partners with a verified ID are given orders.</Text> : null}
        <AdminField label="Orders at once" value={maxOrders} onChangeText={(t) => setMaxOrders(digits(t).slice(0, 2))} keyboardType="number-pad" maxLength={2} hint="1 to 10" />
        <AdminField
          label="Pincodes they cover"
          value={pincodes}
          onChangeText={setPincodes}
          multiline
          maxLength={800}
          keyboardType="numbers-and-punctuation"
          placeholder="560095, 560034"
          hint={pins ? `${pins.length} ${pins.length === 1 ? "pincode" : "pincodes"}` : "Six-digit pincodes, separated by commas or spaces."}
        />
        {[
          { label: "Active", line: active ? "Works with justFit." : "Not working with justFit now.", value: active, set: setActive },
          { label: "Available now", line: available ? "Can be given orders." : "Off duty: gets no orders.", value: available, set: setAvailable },
        ].map((row) => (
          <View key={row.label} className="card flex-row items-center" style={{ gap: 12 }}>
            <View className="flex-1">
              <Text className="card__title">{row.label}</Text>
              <Text className="meta-text">{row.line}</Text>
            </View>
            <Switch value={row.value} onValueChange={row.set} {...switchColors} accessibilityLabel={row.label} />
          </View>
        ))}
        <AdminField label="Note (optional)" value={note} onChangeText={setNote} maxLength={120} placeholder="For example: Evenings only" />
        {error ? <FormAlert message={error} /> : null}
        <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button" accessibilityLabel={saveLabel}>
          {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
          <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{saveLabel}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoider>
  );
}
