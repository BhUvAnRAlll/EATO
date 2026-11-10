import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { SymbolView } from "@/components/SymbolView";
import { AdminField } from "@/components/admin/AdminField";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { ReceiptViewer } from "@/components/gym/ReceiptViewer";
import { phoneText } from "@/data/gymDashboard";
import { BUSINESS_TYPES, REVIEW_ACTIONS, STATUS_TONE, adminReviewApi, documentLabel, fileSize, reasonProblem, type AdminApplication, type ReviewAction } from "@/lib/gymRegistration";
import { FACILITIES, DAYS, dayText } from "@/lib/gymProfile";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { confirmChoice } from "@/lib/nativeSheets";
import { useThemeColors } from "@/theme";

// Super Admin › a gym › Approval: the branch's approval state, the application as the gym sent it
// (business, contact, place, the gym, its logo, photos and documents), the steps that are allowed
// now, each with its reason where one is needed, and the history. onChanged refreshes the page.
export function GymReviewCard({ gymId, onChanged }: { gymId: number; onChanged: () => void }) {
  const colors = useThemeColors();
  const load = useCallback((token: string | null) => adminReviewApi.application(token, gymId), [gymId]);
  const { result, set, retry } = useGymData(load);
  const [picked, setPicked] = useState<ReviewAction | null>(null);
  const [note, setNote] = useState("");
  const [viewing, setViewing] = useState<{ url: string; title: string } | null>(null);
  const decide = useGymSave(
    (data: AdminApplication) => {
      set(data);
      setPicked(null);
      setNote("");
      onChanged();
    },
    () => (picked ? REVIEW_ACTIONS[picked].done : "Saved"),
  );

  if (result.state === "loading") return null;
  if (result.state === "failed") {
    // Before the server's migration the approval isn't there: say so once, quietly
    return (
      <Pressable onPress={retry} className="card" accessibilityRole="button">
        <Text className="type-caption text-muted">{`Approval: ${result.error}`}</Text>
      </Pressable>
    );
  }
  const app = result.data;
  const tone = { neutral: colors.muted, good: colors.success, warn: colors.warning, bad: colors.danger }[STATUS_TONE[app.status]];
  const problem = picked ? reasonProblem(picked, note) : null;

  const run = async () => {
    if (!picked || problem) return;
    const spec = REVIEW_ACTIONS[picked];
    if (spec.danger || picked === "approve") {
      const sure = await confirmChoice({
        title: `${spec.label}?`,
        message: picked === "approve" ? (app.applicant ? `${app.applicant.name} becomes this gym's admin.` : "Members can find the gym once it publishes its profile.") : "The gym is told the reason.",
        confirmLabel: spec.label,
        destructive: !!spec.danger,
      });
      if (!sure) return;
    }
    await decide.save((token) => adminReviewApi.decide(token, gymId, picked, note));
  };

  const rows: [string, string | null][] = [
    ["Business name", app.legalName],
    ["Business type", BUSINESS_TYPES.find((b) => b.id === app.businessType)?.label ?? null],
    ["Contact person", app.contactName],
    ["Contact mobile", app.contactPhone ? phoneText(`+91${app.contactPhone}`) : null],
    ["Contact email", app.contactEmail],
    ["Address", [app.address, app.area, app.city, app.state, app.pincode].filter(Boolean).join(", ")],
    ["Map place", app.latitude !== null && app.longitude !== null ? `${app.latitude.toFixed(5)}, ${app.longitude.toFixed(5)}` : null],
    ["Applied by", app.applicant ? `${app.applicant.name}${app.applicant.phone ? ` · ${app.applicant.phone}` : ""}` : "Made by justFit"],
  ];

  return (
    <View className="card" style={{ gap: 12 }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Text className="card__title flex-1">Approval</Text>
        <Text className="type-caption" style={{ color: tone }}>{app.statusLabel}</Text>
      </View>
      {app.statusNote ? <Text className="type-caption text-muted">{`“${app.statusNote}”`}</Text> : null}

      {rows.map(([label, value]) => (
        <View key={label} className="flex-row" style={{ gap: 12 }}>
          <Text className="type-caption text-muted" style={{ width: 112 }}>{label}</Text>
          <Text className="type-body flex-1">{value || "—"}</Text>
        </View>
      ))}
      {app.about ? <Text className="type-body text-muted">{app.about}</Text> : null}
      {app.facilities.length ? <Text className="type-caption text-muted">{app.facilities.map((f) => FACILITIES.find((x) => x.id === f)?.label ?? f).join(" · ")}</Text> : null}
      {app.hours ? <Text className="type-caption text-muted">{DAYS.map((d) => `${d.short} ${dayText(app.hours?.[d.id] ?? [])}`).join(" · ")}</Text> : null}

      {app.logoUrl || app.photos.length ? (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {app.logoUrl ? (
            <Pressable onPress={() => app.logoUrl && setViewing({ url: app.logoUrl, title: "Logo" })} className="overflow-hidden rounded-md bg-cream-deep" style={{ width: 64, height: 64 }} accessibilityRole="button" accessibilityLabel="Open the logo">
              <MemberPhotoImage url={app.logoUrl} fit="contain" />
            </Pressable>
          ) : null}
          {app.photos.map((p, i) => (
            <Pressable key={p.id} onPress={() => setViewing({ url: p.url, title: i === 0 ? "Cover photo" : `Photo ${i + 1}` })} className="overflow-hidden rounded-md bg-cream-deep" style={{ width: 86, height: 64 }} accessibilityRole="button" accessibilityLabel={`Open photo ${i + 1}`}>
              <MemberPhotoImage url={p.url} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text className="admin-section__title">Documents</Text>
      {app.documents.length === 0 ? <Text className="type-caption text-muted">None sent.</Text> : null}
      {app.documents.map((d) => {
        const image = d.mediaType.startsWith("image/");
        return (
          <Pressable
            key={d.id}
            onPress={image ? () => setViewing({ url: d.url, title: documentLabel(d.kind) }) : undefined}
            disabled={!image}
            className="flex-row items-center"
            style={{ gap: 10 }}
            accessibilityRole={image ? "button" : "text"}
            accessibilityLabel={`${documentLabel(d.kind)}, ${image ? "photo, tap to open" : "PDF"}`}
          >
            <SymbolView name={{ ios: "doc.text", android: "description", web: "description" }} size={18} tintColor={colors.primaryText} />
            <Text className="type-body flex-1">{`${documentLabel(d.kind)} · ${image ? "photo" : "PDF"} · ${fileSize(d.bytes)}`}</Text>
            {image ? <Text className="type-caption text-primary-text">Open</Text> : <Text className="type-caption text-muted">No preview yet</Text>}
          </Pressable>
        );
      })}

      {app.actions.length ? (
        <>
          <Text className="admin-section__title">Decide</Text>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {app.actions.map((a) => (
              <Pressable
                key={a}
                onPress={() => {
                  setPicked(picked === a ? null : a);
                  setNote("");
                }}
                className={picked === a ? "admin-chip admin-chip--on" : "admin-chip"}
                accessibilityRole="button"
                accessibilityState={{ selected: picked === a }}
              >
                <Text className={REVIEW_ACTIONS[a].danger ? "type-caption text-danger" : "type-caption text-ink"}>{REVIEW_ACTIONS[a].label}</Text>
              </Pressable>
            ))}
          </View>
          {picked ? (
            <View style={{ gap: 10 }}>
              {REVIEW_ACTIONS[picked].reason !== "none" ? (
                <AdminField label={REVIEW_ACTIONS[picked].prompt} value={note} onChangeText={setNote} maxLength={300} multiline />
              ) : null}
              {decide.error ? <FormAlert message={decide.error} /> : null}
              <Pressable onPress={run} disabled={decide.busy || !!problem} className={problem ? "btn-forest btn--disabled" : "btn-forest"} accessibilityRole="button" accessibilityState={{ disabled: decide.busy || !!problem, busy: decide.busy }}>
                <Text className={problem ? "btn-forest__label btn--disabled-label" : "btn-forest__label"}>{decide.busy ? "Saving…" : REVIEW_ACTIONS[picked].label}</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      {app.history.length ? (
        <>
          <Text className="admin-section__title">History</Text>
          {app.history.map((h, i) => (
            <View key={`${h.action}-${i}`} style={{ gap: 2 }}>
              <Text className="type-body">{`${h.text} · ${h.by}`}</Text>
              <Text className="type-caption text-muted">{[h.at ? new Date(h.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null, h.note ? `“${h.note}”` : null].filter(Boolean).join(" · ")}</Text>
            </View>
          ))}
        </>
      ) : null}
      {viewing ? <ReceiptViewer url={viewing.url} title={viewing.title} onClose={() => setViewing(null)} /> : null}
    </View>
  );
}
