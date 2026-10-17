import { useState, type ComponentProps } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { gyms } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const inputStyle = { height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, fontSize: 15, color: colors.forestInk } as const;

// Create a gym event (whoever the gym's settings allow). The form checks the obvious things
// so mistakes show at once; the server checks everything again and has the last word.
export default function NewGymEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("08:00");
  const [location, setLocation] = useState("");
  const [max, setMax] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!title.trim()) return "Give the event a title.";
    if (!description.trim()) return "Add a short description.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Write the date as YYYY-MM-DD.";
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return "Write times as HH:MM, for example 07:30.";
    if (endTime <= startTime) return "The event must end after it starts.";
    if (!location.trim()) return "Say where it happens.";
    if (max && !/^[1-9]\d{0,3}$/.test(max)) return "Maximum attendees must be a whole number.";
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    const result = await gyms.createEvent(await getToken(), id, {
      title: title.trim(), description: description.trim(), date, startTime, endTime, location: location.trim(), maxAttendees: max ? Number(max) : null,
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  const field = (label: string, value: string, onChange: (v: string) => void, props: Partial<ComponentProps<typeof TextInput>> = {}) => (
    <View className="flex-1">
      <Text className="auth__label mb-2">{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholderTextColor={colors.faint} accessibilityLabel={label} style={inputStyle} {...props} />
    </View>
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right", "bottom"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Create Event</Text>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
            {field("Title", title, setTitle, { placeholder: "Deadlift clinic", maxLength: 80 })}
            <View>
              <Text className="auth__label mb-2">Description</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder="What to expect and what to bring" placeholderTextColor={colors.faint} multiline maxLength={1000} accessibilityLabel="Description" style={{ ...inputStyle, height: 110, paddingTop: 12, textAlignVertical: "top" }} />
            </View>
            {field("Date", date, setDate, { placeholder: "YYYY-MM-DD", maxLength: 10, autoCorrect: false })}
            <View className="flex-row gap-3">
              {field("Starts", startTime, setStartTime, { placeholder: "07:00", maxLength: 5, autoCorrect: false })}
              {field("Ends", endTime, setEndTime, { placeholder: "08:00", maxLength: 5, autoCorrect: false })}
            </View>
            {field("Location", location, setLocation, { placeholder: "Main floor", maxLength: 120 })}
            {field("Maximum attendees (optional)", max, setMax, { placeholder: "No limit", keyboardType: "number-pad", maxLength: 4 })}
            {error && <FormAlert message={error} />}
            <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Create event">
              {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Create event</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
