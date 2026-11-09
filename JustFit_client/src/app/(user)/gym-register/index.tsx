import { useCallback, useState } from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { SetupField } from "@/components/setup/SetupField";
import { RegisterFrame } from "@/components/gymRegister/RegisterParts";
import { SECTIONS, missingIn, registrationApi, statusMessage, type Application } from "@/lib/gymRegistration";
import { confirmChoice } from "@/lib/nativeSheets";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useGymRegistration } from "@/store/gymRegistration";
import { useThemeColors } from "@/theme";

// Register your gym (Gym Hub ecosystem phase 1): where the member's application stands, the four
// sections to fill in (each with what is still missing), Submit for review, and the history of
// justFit's decisions. With no application yet, a short form starts one.
export default function RegisterGym() {
  const getToken = useSessionToken();
  const load = useGymRegistration((state) => state.load);
  const read = useGymRegistration((state) => state.read);
  useFocusEffect(
    useCallback(() => {
      getToken().then(read).catch(() => {});
    }, [getToken, read]),
  );

  if (load.state === "loading") return <RegisterFrame title="Register your gym"><ScreenSkeleton cards={3} label="Loading your application" /></RegisterFrame>;
  if (load.state === "failed") {
    return (
      <RegisterFrame title="Register your gym">
        <View className="card" style={{ gap: 12 }}>
          <FormAlert message={load.error} />
          <PrimaryButton label="Try again" onPress={async () => read(await getToken().catch(() => null))} />
        </View>
      </RegisterFrame>
    );
  }
  const { current, canStart, applications } = load.data;
  if (!current) return <StartForm canStart={canStart} hadApproved={applications.some((a) => a.status === "approved")} />;
  return <Overview app={current} />;
}

function StartForm({ canStart, hadApproved }: { canStart: boolean; hadApproved: boolean }) {
  const getToken = useSessionToken();
  const put = useGymRegistration((state) => state.put);
  const [gymName, setGymName] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = gymName.trim().length >= 2 && area.trim().length >= 2 && city.trim().length >= 2;

  const start = async () => {
    if (!ready || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    const answer = await registrationApi.start(await getToken().catch(() => null), { gymName: gymName.trim(), area: area.trim(), city: city.trim() });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    put(answer.data);
    hud.success("Application started");
  };

  return (
    <RegisterFrame
      title="Register your gym"
      action={canStart ? <PrimaryButton label="Start application" onPress={start} loading={busy} disabled={!ready} /> : undefined}
    >
      <View className="card" style={{ gap: 8 }}>
        <Text className="card__title">Bring your gym to justFit</Text>
        <Text className="type-body text-muted">
          Members will find your gym, compare your plans and check in with a QR code. Tell us about the gym and send an address proof; the justFit team reviews every gym before it goes live.
        </Text>
        <Text className="type-caption text-muted">{"Once approved, this account becomes the gym's admin and opens the gym portal instead of the member app."}</Text>
      </View>
      {canStart ? (
        <>
          <Text className="setup__section mt-2">Your gym</Text>
          <SetupField label="Gym name" icon={{ ios: "dumbbell", android: "fitness_center", web: "fitness_center" }} value={gymName} onChangeText={(t) => setGymName(t.slice(0, 80))} placeholder="Iron House Fitness" autoCapitalize="words" maxLength={80} />
          <SetupField label="Area" icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} value={area} onChangeText={(t) => setArea(t.slice(0, 80))} placeholder="Indiranagar" autoCapitalize="words" maxLength={80} />
          <SetupField label="City" icon={{ ios: "map", android: "map", web: "map" }} value={city} onChangeText={(t) => setCity(t.slice(0, 60))} placeholder="Bengaluru" autoCapitalize="words" maxLength={60} />
          {error ? <FormAlert message={error} /> : null}
        </>
      ) : (
        <View className="card">
          <Text className="type-body text-muted">
            {hadApproved ? "Your gym is approved. Open the app again to reach the gym portal." : "This account works with justFit as a team account, so it can't register a gym. Sign in with a member account to apply."}
          </Text>
        </View>
      )}
    </RegisterFrame>
  );
}

function Overview({ app }: { app: Application }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const put = useGymRegistration((state) => state.put);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = statusMessage(app);
  const toneColor = { neutral: colors.ink, good: colors.success, warn: colors.warning, bad: colors.danger }[message.tone];

  const submit = async () => {
    if (busy || app.missing.length > 0) return;
    const sure = await confirmChoice({ title: "Submit for review?", message: "You can't change the application while justFit reviews it.", confirmLabel: "Submit", destructive: false });
    if (!sure) return;
    setBusy(true);
    setError(null);
    const answer = await registrationApi.submit(await getToken().catch(() => null), app.id);
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    put(answer.data);
    hud.success("Sent for review");
  };

  // After approval the account is a gym admin: the app re-reads who it is and opens the portal
  const openPortal = () => void useAuthStore.getState().recheck();

  return (
    <RegisterFrame
      title="Register your gym"
      subtitle={`${app.gymName} · ${app.area}, ${app.city}`}
      action={
        app.canSubmit ? (
          <PrimaryButton label={app.missing.length ? `${app.missing.length} left to fill in` : app.status === "rejected" ? "Send again for review" : "Submit for review"} onPress={submit} loading={busy} disabled={app.missing.length > 0} />
        ) : app.status === "approved" ? (
          <PrimaryButton label="Open the gym portal" onPress={openPortal} />
        ) : undefined
      }
    >
      <View className="card" style={{ gap: 6 }} accessibilityRole="summary">
        <Text className="type-caption" style={{ color: toneColor }}>{app.statusLabel.toUpperCase()}</Text>
        <Text className="card__title">{message.title}</Text>
        <Text className="type-body text-muted">{message.body}</Text>
      </View>
      {error ? <FormAlert message={error} /> : null}

      <View className="card py-1">
        {SECTIONS.map((section, index) => {
          const left = missingIn(app, section.key);
          return (
            <Pressable
              key={section.key}
              onPress={() => router.push(section.href)}
              disabled={!app.canEdit}
              className="list-row"
              style={index === SECTIONS.length - 1 ? { borderBottomWidth: 0 } : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${section.title}, ${left ? `${left} missing` : "done"}`}
            >
              <SymbolView
                name={left ? { ios: "circle", android: "radio_button_unchecked", web: "radio_button_unchecked" } : { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }}
                size={20}
                tintColor={left ? colors.faint : colors.primary}
              />
              <View className="flex-1" style={{ gap: 2 }}>
                <Text className="list-row__label">{section.title}</Text>
                <Text className="type-caption text-muted">{left ? `${left} still needed` : section.line}</Text>
              </View>
              {app.canEdit ? <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} /> : null}
            </Pressable>
          );
        })}
      </View>

      {app.missing.length > 0 && app.canEdit ? (
        <View className="card" style={{ gap: 4 }}>
          <Text className="setup__section">Still needed</Text>
          {app.missing.map((m) => <Text key={m.text} className="type-body text-muted">• {m.text}</Text>)}
        </View>
      ) : null}

      {app.history.length > 0 ? (
        <View className="card" style={{ gap: 10 }}>
          <Text className="setup__section">History</Text>
          {app.history.map((step, i) => (
            <View key={`${step.action}-${step.at}-${i}`} style={{ gap: 2 }}>
              <Text className="type-body">{step.text} · {step.by}</Text>
              {step.at ? <Text className="type-caption text-muted">{new Date(step.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</Text> : null}
              {step.note ? <Text className="type-caption text-muted">“{step.note}”</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </RegisterFrame>
  );
}
