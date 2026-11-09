import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { FormAlert } from "@/components/FormAlert";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { AdminField } from "@/components/admin/AdminField";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { apiFetch, type ApiResult } from "@/lib/api";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useSwitchColors } from "@/theme";

type DocKind = "registration" | "address" | "other";
type Settings = {
  registrationOpen: boolean;
  requiredDocuments: DocKind[];
  pausePolicy: { maxPerYear: number | null; maxDaysPerYear: number | null; maxDaysEach: number };
  crowdThresholds: { moderate: number; busy: number; veryBusy: number };
};
type Answer = { settings: Settings };
const DOCS: { id: DocKind; label: string }[] = [
  { id: "address", label: "Address proof" },
  { id: "registration", label: "Business registration" },
  { id: "other", label: "Another supporting document" },
];
const load = (token: string | null): Promise<ApiResult<Answer>> => (token ? apiFetch<Answer>("/api/admin/portal/platform-settings", { token }) : Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 }));
const num = (t: string) => (t.trim() === "" ? null : /^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : Number.NaN);
const txt = (n: number | null) => (n === null ? "" : String(n));

// Super Admin › Platform settings (the brief's section 7): gym registration on or off, the documents
// an application must include, and the default pause limits and crowd levels for branches that
// haven't set their own. The server checks every value again (platform/settingsRules.js).
export default function PlatformSettings() {
  const { result, retry, set } = useGymData(load);
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Platform settings" fallback="/admin/profile" />
        {result.state === "loading" ? <View className="p-4"><ScreenSkeleton cards={3} label="Loading settings" /></View> : null}
        {result.state === "failed" ? <View className="p-4"><DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load settings" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /></View> : null}
        {result.state === "ready" ? <Form initial={result.data.settings} onSaved={(s) => set({ settings: s })} /> : null}
      </SafeAreaView>
    </View>
  );
}

function Form({ initial, onSaved }: { initial: Settings; onSaved: (s: Settings) => void }) {
  const switchColors = useSwitchColors();
  const [open, setOpen] = useState(initial.registrationOpen);
  const [docs, setDocs] = useState<DocKind[]>(initial.requiredDocuments);
  const [perYear, setPerYear] = useState(txt(initial.pausePolicy.maxPerYear));
  const [daysYear, setDaysYear] = useState(txt(initial.pausePolicy.maxDaysPerYear));
  const [each, setEach] = useState(String(initial.pausePolicy.maxDaysEach));
  const [levels, setLevels] = useState({ moderate: String(initial.crowdThresholds.moderate), busy: String(initial.crowdThresholds.busy), veryBusy: String(initial.crowdThresholds.veryBusy) });
  const save = useGymSave(({ settings }: Answer) => onSaved(settings), "Settings saved");

  const p = { maxPerYear: num(perYear), maxDaysPerYear: num(daysYear), maxDaysEach: num(each) };
  const t = { moderate: num(levels.moderate), busy: num(levels.busy), veryBusy: num(levels.veryBusy) };
  const problem = [p.maxPerYear, p.maxDaysPerYear, p.maxDaysEach, t.moderate, t.busy, t.veryBusy].some((v) => Number.isNaN(v)) ? "Use whole numbers."
    : p.maxDaysEach === null ? "Set the longest pause."
    : t.moderate === null || t.busy === null || t.veryBusy === null || !(t.moderate < t.busy && t.busy < t.veryBusy) ? "Crowd levels start at rising percentages."
    : null;

  const submit = () => {
    if (problem) return;
    save.save((token) => (token ? apiFetch<Answer>("/api/admin/portal/platform-settings", { token, method: "PUT", body: { registrationOpen: open, requiredDocuments: docs, pausePolicy: p, crowdThresholds: t } }) : Promise.resolve({ ok: false as const, error: "Please sign in again." })));
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View className="card flex-row items-center" style={{ gap: 12 }}>
        <View className="flex-1" style={{ gap: 2 }}>
          <Text className="card__title">Gym registration open</Text>
          <Text className="meta-text">{"Off: members can't start new gym applications. Drafts already started go on."}</Text>
        </View>
        <Switch value={open} onValueChange={setOpen} {...switchColors} accessibilityLabel="Gym registration open" />
      </View>
      <View className="card" style={{ gap: 8 }}>
        <Text className="card__title">Documents an application needs</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {DOCS.map((d) => (
            <Pressable key={d.id} onPress={() => setDocs((list) => (list.includes(d.id) ? list.filter((x) => x !== d.id) : [...list, d.id]))} className={docs.includes(d.id) ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: docs.includes(d.id) }}>
              <Text className="type-caption text-ink">{d.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View className="card" style={{ gap: 8 }}>
        <Text className="card__title">Default pause limits</Text>
        <Text className="meta-text">{"For branches that haven't set their own. Empty means no limit."}</Text>
        <AdminField label="Pauses a year" value={perYear} onChangeText={(v) => setPerYear(v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" />
        <AdminField label="Pause days a year" value={daysYear} onChangeText={(v) => setDaysYear(v.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" />
        <AdminField label="Longest single pause (days)" value={each} onChangeText={(v) => setEach(v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" />
      </View>
      <View className="card" style={{ gap: 8 }}>
        <Text className="card__title">Default crowd levels (% of capacity)</Text>
        {(["moderate", "busy", "veryBusy"] as const).map((k) => (
          <AdminField key={k} label={k === "veryBusy" ? "Very busy from" : `${k === "busy" ? "Busy" : "Moderate"} from`} value={levels[k]} onChangeText={(v) => setLevels((l) => ({ ...l, [k]: v.replace(/\D/g, "").slice(0, 3) }))} keyboardType="number-pad" />
        ))}
      </View>
      {problem ? <Text className="meta-text">{problem}</Text> : null}
      {save.error ? <FormAlert message={save.error} /> : null}
      <Pressable onPress={submit} disabled={!!problem || save.busy} className={problem ? "btn-forest btn--disabled" : "btn-forest"} accessibilityRole="button">
        <Text className={problem ? "btn-forest__label btn--disabled-label" : "btn-forest__label"}>{save.busy ? "Saving…" : "Save settings"}</Text>
      </Pressable>
    </ScrollView>
  );
}
