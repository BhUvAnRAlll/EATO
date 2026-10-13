import { useEffect, useEffectEvent, useState, type ComponentType } from "react";
import { Modal, Platform, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";

import { PrimaryButton } from "@/components/PrimaryButton";
import { colors } from "@/theme";

type DatePickerSheetProps = {
  visible: boolean;
  title: string;
  value: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
};

type WebDateInputProps = TextInputProps & { type: "date"; min?: string; max?: string };
const WebDateInput = TextInput as unknown as ComponentType<WebDateInputProps>;

const dateInputValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

// iOS: bottom sheet with the date wheel and Cancel / Done.
// Android: the system calendar dialog.
export function DatePickerSheet(props: DatePickerSheetProps) {
  const { visible, value, minimumDate, maximumDate, onSelect, onClose } = props;

  // Android's dialog is opened imperatively. As an effect event this always sees the
  // latest props without re-running (and re-opening the dialog) on every render.
  const openAndroidDialog = useEffectEvent(() => {
    DateTimePickerAndroid.open({
      value,
      mode: "date",
      minimumDate,
      maximumDate,
      onChange: (event, date) => {
        if (event.type === "set" && date) onSelect(date);
        onClose();
      },
    });
  });

  useEffect(() => {
    if (Platform.OS === "android" && visible) openAndroidDialog();
  }, [visible]);

  if (Platform.OS === "android") return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {visible &&
        (Platform.OS === "web" ? <WebDateSheet {...props} /> : <IosDateSheet {...props} />)}
    </Modal>
  );
}

function WebDateSheet({ title, value, minimumDate, maximumDate, onSelect, onClose }: DatePickerSheetProps) {
  const [draft, setDraft] = useState(dateInputValue(value));
  const selectedDate = parseDateInput(draft);
  const minimumValue = minimumDate ? dateInputValue(minimumDate) : undefined;
  const maximumValue = maximumDate ? dateInputValue(maximumDate) : undefined;
  const isInRange =
    selectedDate !== null &&
    (!minimumValue || draft >= minimumValue) &&
    (!maximumValue || draft <= maximumValue);

  return (
    <View className="verify__backdrop">
      <Pressable className="flex-1" onPress={onClose} />
      <View className="verify__sheet">
        <View className="flex-row items-center justify-between">
          <Text className="setup__title">{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text className="auth__link">Cancel</Text>
          </Pressable>
        </View>
        <WebDateInput
          className="mt-5 w-full rounded-md border border-line bg-surface px-4 py-3 text-ink"
          type="date"
          value={draft}
          min={minimumValue}
          max={maximumValue}
          onChangeText={setDraft}
        />
        <PrimaryButton
          label="Done"
          onPress={() => {
            if (isInRange && selectedDate) onSelect(selectedDate);
            onClose();
          }}
        />
      </View>
    </View>
  );
}

function IosDateSheet({ title, value, minimumDate, maximumDate, onSelect, onClose }: DatePickerSheetProps) {
  const [draft, setDraft] = useState(value);

  return (
    <View className="verify__backdrop">
      <Pressable className="flex-1" onPress={onClose} />
      <View className="verify__sheet">
        <View className="flex-row items-center justify-between">
          <Text className="setup__title">{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text className="auth__link">Cancel</Text>
          </Pressable>
        </View>

        <DateTimePicker
          value={draft}
          mode="date"
          display="spinner"
          themeVariant="light"
          textColor={colors.forestInk}
          accentColor={colors.forest}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(_, date) => date && setDraft(date)}
        />

        <PrimaryButton
          label="Done"
          onPress={() => {
            onSelect(draft);
            onClose();
          }}
        />
      </View>
    </View>
  );
}
