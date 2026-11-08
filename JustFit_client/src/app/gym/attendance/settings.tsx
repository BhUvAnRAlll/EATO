import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { AttendanceMap, type LatLng, type MapFocus } from "@/components/gym/AttendanceMap";
import { GymChips, GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { gymApi, type AttendanceSettings } from "@/lib/gymApi";
import { readGps } from "@/lib/gpsReading";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const PRESETS = [50, 100, 150, 200, 500];
// A keyboard with digits, a dot and a minus: iOS has one; Android's numeric pad has the signs too
// ("numbers-and-punctuation" is iOS-only and gave Android the full keyboard, QA 2026-11-07)
const COORD_KEYBOARD = Platform.select({ ios: "numbers-and-punctuation" as const, default: "numeric" as const });
const coordText = (n: number) => n.toFixed(6);
// A typed coordinate, or null when it isn't one
const parseCoord = (text: string, max: number) => {
  if (!/^-?\d{1,3}(\.\d+)?$/.test(text.trim())) return null;
  const n = Number(text);
  return Math.abs(n) <= max ? n : null;
};

// Gym admin › Gym Location & Attendance Settings: the branch's name, its entrance on the map
// (search a place, use the phone's location, tap or drag the pin, or type the coordinates) and
// the radius members must be within to check in or out. The server checks every value again.
export default function GymAttendanceSettings() {
  const { result, retry, set } = useGymData(gymApi.attendanceSettings);
  return (
    <GymScreen title="Location & Attendance">
      {result.state === "loading" && <GymLoading label="Loading the settings" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && <SettingsForm settings={result.data} onSaved={set} />}
    </GymScreen>
  );
}

function SettingsForm({ settings, onSaved }: { settings: AttendanceSettings; onSaved: (s: AttendanceSettings) => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { min, max } = settings.radiusLimits;
  const [branch, setBranch] = useState(settings.gym.branch);
  const [lat, setLat] = useState(settings.location ? coordText(settings.location.latitude) : "");
  const [lng, setLng] = useState(settings.location ? coordText(settings.location.longitude) : "");
  const [radius, setRadius] = useState(String(settings.radiusM));
  const [focus, setFocus] = useState<MapFocus>(null);
  const [search, setSearch] = useState("");
  const [finding, setFinding] = useState<"search" | "gps" | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const latitude = parseCoord(lat, 90);
  const longitude = parseCoord(lng, 180);
  const place: LatLng | null = latitude !== null && longitude !== null ? { latitude, longitude } : null;
  const radiusM = /^\d{1,4}$/.test(radius) ? Number(radius) : Number.NaN;
  const radiusOk = Number.isInteger(radiusM) && radiusM >= min && radiusM <= max;
  const nameOk = branch.trim().length >= 2;
  const ready = Boolean(place) && radiusOk && nameOk;

  const pick = useCallback((p: LatLng, move = false) => {
    setLat(coordText(p.latitude));
    setLng(coordText(p.longitude));
    setSaved("");
    if (move) setFocus({ place: p, radiusM: Number(radius) || settings.radiusM });
  }, [radius, settings.radiusM]);

  const findPlace = async () => {
    const text = search.trim();
    if (text.length < 3 || finding) return;
    setFinding("search");
    setMessage("");
    try {
      // Android's geocoder needs the location permission first
      if (Platform.OS === "android") await Location.requestForegroundPermissionsAsync();
      const found = await Location.geocodeAsync(text);
      if (found.length === 0) setMessage("No place found. Try the area and city, e.g. \"Batawadi, Tumakuru\".");
      else pick({ latitude: found[0].latitude, longitude: found[0].longitude }, true);
    } catch {
      setMessage("Search isn't working right now. Use your current location or tap the map.");
    }
    setFinding(null);
  };

  const useHere = async () => {
    if (finding) return;
    setFinding("gps");
    setMessage("");
    const gps = await readGps();
    setFinding(null);
    if (!gps.ok) return setMessage(gps.message);
    pick(gps.reading, true);
    setMessage(`Location found (accurate to about ${Math.round(gps.reading.accuracy)} m). Drag the pin to the entrance if needed.`);
  };

  const save = async () => {
    if (!ready || !place || saving) return;
    setSaving(true);
    setError("");
    const token = await getToken().catch(() => null);
    // The place first (every attendance login may save it), then the name (the gym admin's alone:
    // a Staff login's rename is refused without undoing the place)
    const answer = await gymApi.saveAttendancePlace(token, { ...place, radiusM });
    if (!answer.ok) {
      setSaving(false);
      return setError(answer.error);
    }
    if (branch.trim() !== settings.gym.branch) {
      const renamed = await gymApi.updateDetails(token, { branch: branch.trim() });
      if (!renamed.ok) {
        setSaving(false);
        onSaved(answer.data);
        return setError(`The location and radius were saved. The name wasn't: ${renamed.error}`);
      }
    }
    setSaving(false);
    haptic.success();
    onSaved(answer.data);
    setSaved(`Saved: ${coordText(place.latitude)}, ${coordText(place.longitude)} · ${radiusM} m radius`);
  };

  return (
    <View style={{ gap: 16 }}>
      <View className="gym-summary">
        <Text className="gym-tx__meta">{settings.gym.name}</Text>
        <Text className="gym-tx__name">
          {settings.location ? `Saved: ${coordText(settings.location.latitude)}, ${coordText(settings.location.longitude)}` : "No location saved yet"}
        </Text>
        <Text className="gym-tx__meta">{`Attendance radius: ${settings.radiusM} m`}</Text>
      </View>

      <GymField label="Gym / branch name" value={branch} onChangeText={(t) => { setBranch(t.slice(0, 80)); setSaved(""); }} placeholder="e.g. Tumkur" autoCapitalize="words" />

      <Text className="gym-section-title" accessibilityRole="header">Gym location</Text>
      {Platform.OS !== "web" && (
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View className="gym-field--icon flex-1">
            <GymIcon name="search" size={18} color={colors.gymMuted} />
            <TextInput
              value={search}
              onChangeText={(t) => setSearch(t.slice(0, 120))}
              onSubmitEditing={findPlace}
              placeholder="Search a place or address"
              placeholderTextColor={colors.gymFaint}
              className="gym-field__icon-input"
              accessibilityLabel="Search the gym's place or address"
              returnKeyType="search"
            />
          </View>
          <PressableScale onPress={findPlace} disabled={search.trim().length < 3 || finding !== null} className="gym-choice" style={{ opacity: search.trim().length < 3 ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Search">
            {finding === "search" ? <ActivityIndicator size="small" color={colors.gymPrimary} /> : <Text className="gym-choice__label">Search</Text>}
          </PressableScale>
        </View>
      )}
      <PressableScale onPress={useHere} disabled={finding !== null} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Use my current location">
        {finding === "gps" ? <ActivityIndicator size="small" color={colors.gymPrimary} /> : <GymIcon name="locate-fixed" size={16} color={colors.gymPrimary} />}
        <Text className="gym-btn__label gym-btn__label--outline">Use my current location</Text>
      </PressableScale>
      {message ? <Text className="gym-tx__meta" accessibilityLiveRegion="polite">{message}</Text> : null}

      <AttendanceMap place={place} radiusM={radiusOk ? radiusM : settings.radiusM} onPick={(p) => pick(p)} focus={focus} />

      <View className="flex-row" style={{ gap: 10 }}>
        <View className="flex-1">
          <GymField label="Latitude" value={lat} onChangeText={(t) => { setLat(t.replace(/[^0-9.-]/g, "").slice(0, 12)); setSaved(""); }} onEndEditing={() => place && setFocus({ place, radiusM: radiusOk ? radiusM : settings.radiusM })} keyboardType={COORD_KEYBOARD} placeholder="13.339200" hint={lat && latitude === null ? "Between -90 and 90" : undefined} />
        </View>
        <View className="flex-1">
          <GymField label="Longitude" value={lng} onChangeText={(t) => { setLng(t.replace(/[^0-9.-]/g, "").slice(0, 12)); setSaved(""); }} onEndEditing={() => place && setFocus({ place, radiusM: radiusOk ? radiusM : settings.radiusM })} keyboardType={COORD_KEYBOARD} placeholder="77.101200" hint={lng && longitude === null ? "Between -180 and 180" : undefined} />
        </View>
      </View>

      <Text className="gym-section-title" accessibilityRole="header">QR attendance radius</Text>
      <GymField
        label="Attendance radius (metres)"
        value={radius}
        onChangeText={(t) => { setRadius(t.replace(/[^0-9]/g, "").slice(0, 4)); setSaved(""); }}
        keyboardType="number-pad"
        placeholder="100"
        hint={radiusOk ? `Members must be within ${radiusM} m of the pin to check in or out.` : `Enter ${min} to ${max} metres.`}
      />
      <GymChips options={PRESETS.map((m) => ({ value: m, label: `${m} m` }))} value={radiusOk ? radiusM : -1} onChange={(m) => { setRadius(String(m)); setSaved(""); }} />

      {error ? <FormAlert message={error} /> : null}
      {saved ? <Text className="gym-tx__name" style={{ color: colors.gymSuccess }} accessibilityLiveRegion="polite">{saved}</Text> : null}
      <GymPrimaryButton label="Save Location & Settings" ready={ready} busy={saving} onPress={save} />
    </View>
  );
}
