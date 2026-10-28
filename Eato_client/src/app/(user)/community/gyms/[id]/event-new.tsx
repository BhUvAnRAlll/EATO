import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { formatTime } from "@/lib/gymRules";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const DAYS_SHOWN = 45; // the date strip: today and the next six weeks
const MAX_ATTENDEES = 1000;

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Every 15 minutes from 05:00 to 23:45
const TIMES = Array.from({ length: (24 - 5) * 4 }, (_, i) => `${pad(5 + Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

// Create Event (whoever the gym's settings allow): title, description, a date from the strip,
// start and end times from a list, a location (with suggestions from the gym and its recent
// events) and an optional cap. The form catches the obvious mistakes; the server checks
// everything again and has the last word.
export default function NewGymEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<Gym | null>(null);
  const [places, setPlaces] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  const [location, setLocation] = useState("");
  const [max, setMax] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = new Date();
    return Array.from({ length: DAYS_SHOWN }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, []);

  // The gym (its name and address) and the places its recent events used, as suggestions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const [gymResult, eventsResult] = await Promise.all([gyms.get(token, id), gyms.events(token, id)]);
      if (cancelled) return;
      const suggestions: string[] = [];
      if (eventsResult.ok) for (const event of eventsResult.data.events) suggestions.push(event.location);
      if (gymResult.ok) {
        setGym(gymResult.data.gym);
        if (gymResult.data.gym.address) suggestions.push(gymResult.data.gym.address);
        if (gymResult.data.gym.location) suggestions.push(gymResult.data.gym.location);
      }
      setPlaces([...new Set(suggestions.map((place) => place.trim()).filter(Boolean))].slice(0, 6));
    })();
    return () => {
      cancelled = true;
    };
  }, [id, getToken]);

  const validate = (): string | null => {
    if (!title.trim()) return "Give the event a title.";
    if (!description.trim()) return "Add a short description.";
    if (!date) return "Pick the event date.";
    if (!startTime || !endTime) return "Pick a start and an end time.";
    if (endTime <= startTime) return "The event must end after it starts.";
    if (!location.trim()) return "Say where it happens.";
    if (max.trim() && (!/^\d{1,4}$/.test(max.trim()) || Number(max) < 1 || Number(max) > MAX_ATTENDEES)) return `Maximum attendees must be a whole number from 1 to ${MAX_ATTENDEES}.`;
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    const result = await gyms.createEvent(await getToken(), id, {
      title: title.trim(),
      description: description.trim(),
      date: date ?? "",
      startTime: startTime ?? "",
      endTime: endTime ?? "",
      location: location.trim(),
      maxAttendees: max.trim() ? Number(max) : null,
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  const choose = (time: string) => {
    if (picking === "start") {
      setStartTime(time);
      // Keep the end after the start: default to an hour later
      if (!endTime || endTime <= time) setEndTime(TIMES[Math.min(TIMES.length - 1, TIMES.indexOf(time) + 4)]);
    } else setEndTime(time);
    setPicking(null);
    setError(null);
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title">Create Event</Text>
            {gym && <Text className="gym-card__meta" numberOfLines={1}>{gym.name}</Text>}
          </View>
          <View className="screen-bar__back" />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }} keyboardShouldPersistTaps="handled">
            <View className="gap-2">
              <Text className="compose__label">Event title<Text className="compose__required"> *</Text></Text>
              <TextInput className="compose__input" value={title} onChangeText={(value) => { setTitle(value); setError(null); }} maxLength={120} placeholder="e.g. Saturday Strength Clinic" placeholderTextColor={colors.faint} accessibilityLabel="Title" />
            </View>
            <View className="gap-2">
              <Text className="compose__label">Description<Text className="compose__required"> *</Text></Text>
              <TextInput className="compose__caption" value={description} onChangeText={(value) => { setDescription(value); setError(null); }} maxLength={1000} multiline textAlignVertical="top" placeholder="What should people expect and bring?" placeholderTextColor={colors.faint} accessibilityLabel="Description" />
            </View>

            <View className="gap-2">
              <Text className="compose__label">Event date<Text className="compose__required"> *</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                {days.map((day) => {
                  const value = isoDay(day);
                  const selected = date === value;
                  const weekday = day.toLocaleDateString("en-GB", { weekday: "short" });
                  const month = day.toLocaleDateString("en-GB", { month: "short" });
                  return (
                    <Pressable key={value} onPress={() => { setDate(value); setError(null); }} className={selected ? "date-chip date-chip--selected" : "date-chip"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`Date: ${weekday} ${day.getDate()} ${month}`}>
                      <Text className={selected ? "date-chip__small date-chip__text--selected" : "date-chip__small"}>{weekday}</Text>
                      <Text className={selected ? "date-chip__day date-chip__text--selected" : "date-chip__day"}>{day.getDate()}</Text>
                      <Text className={selected ? "date-chip__small date-chip__text--selected" : "date-chip__small"}>{month}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View className="flex-row gap-3">
              {(["start", "end"] as const).map((which) => {
                const value = which === "start" ? startTime : endTime;
                return (
                  <View key={which} className="min-w-0 flex-1 gap-2">
                    <Text className="compose__label">{which === "start" ? "Start time" : "End time"}<Text className="compose__required"> *</Text></Text>
                    <Pressable onPress={() => setPicking(which)} className="compose__input flex-row items-center justify-between" accessibilityRole="button" accessibilityLabel={which === "start" ? `Start time${value ? `: ${formatTime(value)}` : ""}` : `End time${value ? `: ${formatTime(value)}` : ""}`}>
                      <Text className="post__body">{value ? formatTime(value) : "Select"}</Text>
                      <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={14} tintColor={colors.ink} />
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <View className="gap-2">
              <Text className="compose__label">Location<Text className="compose__required"> *</Text></Text>
              <TextInput className="compose__input" value={location} onChangeText={(value) => { setLocation(value); setError(null); }} maxLength={120} placeholder="Where will it happen?" placeholderTextColor={colors.faint} accessibilityLabel="Location" />
              {places.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                  {places.map((place) => (
                    <Pressable key={place} onPress={() => { setLocation(place); setError(null); }} className={location.trim() === place ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="button" accessibilityLabel={`Location: ${place}`}>
                      <Text className={location.trim() === place ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"} numberOfLines={1}>{place}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>

            <View className="gap-2">
              <Text className="compose__label">Maximum attendees <Text className="setup__optional">(optional)</Text></Text>
              <TextInput className="compose__input" value={max} onChangeText={(value) => { setMax(value); setError(null); }} keyboardType="number-pad" maxLength={4} placeholder="No limit" placeholderTextColor={colors.faint} accessibilityLabel="Maximum attendees (optional)" />
              <Text className="home__note">Leave empty for unlimited spots.</Text>
            </View>

            {error && <FormAlert message={error} />}
          </ScrollView>
          <View className="compose__footer">
            <Pressable onPress={save} disabled={saving} className="btn-forest flex-1" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Create event">
              {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Create Event</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable className="verify__backdrop" onPress={() => setPicking(null)} accessibilityLabel="Close">
          <Pressable className="verify__sheet gap-2" onPress={() => {}} accessibilityViewIsModal>
            <Text className="setup__section text-center">{picking === "start" ? "Start time" : "End time"}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {TIMES.filter((time) => picking !== "end" || !startTime || time > startTime).map((time) => {
                const selected = (picking === "start" ? startTime : endTime) === time;
                return (
                  <Pressable key={time} onPress={() => choose(time)} className={selected ? "time-option time-option--selected" : "time-option"} accessibilityRole="button" accessibilityLabel={`${picking === "start" ? "Start" : "End"} at ${formatTime(time)}`}>
                    <Text className={selected ? "time-option__label time-option__label--selected" : "time-option__label"}>{formatTime(time)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
