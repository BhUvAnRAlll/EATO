import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { STAFF_ROLES, STAFF_ROLE_LABEL } from "@/data/kitchens";
import type { KitchenStaff, StaffInput, StaffRole } from "@/lib/kitchensApi";
import { useSwitchColors, useThemeColors } from "@/theme";

const ROLES = STAFF_ROLES.map((value) => ({ value, label: STAFF_ROLE_LABEL[value] }));

// Super Admin › a kitchen › Staff: add or edit one person on the roster (name, number, role,
// available today, a note). They don't sign in yet: the roster is for the Super Admin.
export function KitchenStaffSheet({ person, onSave, onClose }: { person: KitchenStaff | null; onSave: (input: StaffInput) => Promise<string | null>; onClose: () => void }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [name, setName] = useState(person?.name ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [role, setRole] = useState<StaffRole>(person?.role ?? "chef");
  const [available, setAvailable] = useState(person?.available ?? true);
  const [note, setNote] = useState(person?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = name.trim().length >= 2 && phone.length === 10;

  const save = async (dismiss: () => void) => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    const problem = await onSave({ name: name.trim(), phone, role, available, note: note.trim() || null });
    setBusy(false);
    if (problem) return setError(problem);
    dismiss();
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {(dismiss) => (
        <KeyboardAvoider fill={false}>
          <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text className="type-headline text-forest-ink">{person ? "Edit staff" : "Add staff"}</Text>
            <AdminField label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="For example: Anita Sharma" />
            <AdminField label="Mobile number" value={phone} onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, "").slice(0, 10))} keyboardType="number-pad" maxLength={10} placeholder="10 digits" />
            <ChoiceChips label="Role" options={ROLES} value={role} onChange={setRole} />
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="card__title">Available</Text>
                <Text className="meta-text">{available ? "Working as usual." : "Away for now."}</Text>
              </View>
              <Switch value={available} onValueChange={setAvailable} {...switchColors} accessibilityLabel="Available" />
            </View>
            <AdminField label="Note (optional)" value={note} onChangeText={setNote} maxLength={120} placeholder="For example: Morning shift" />
            {error ? <FormAlert message={error} /> : null}
            <Pressable onPress={() => save(dismiss)} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
              {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
              <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{person ? "Save changes" : "Add to staff"}</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
