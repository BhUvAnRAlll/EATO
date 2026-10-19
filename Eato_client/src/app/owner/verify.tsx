import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";

import { Avatar } from "@/components/community/Avatar";
import { roleLabels } from "@/lib/gymRules";
import { durationLabel, owner, refusalTitles, timeLabel, type Verification, type Visit } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

type Step = { kind: "checking" } | { kind: "result"; result: Verification } | { kind: "done"; visit: Visit } | { kind: "error"; message: string };

// "Active until 2026-11-27", "Package expired on 2026-10-16", "No package recorded"
function statusLine(result: Verification): string {
  const m = result.member;
  if (!m) return "—";
  if (m.status !== "active") return m.status === "pending" ? "Waiting for approval" : "Suspended";
  if (!m.plan) return "Active · no package recorded";
  if (m.plan.endsOn === null) return "Active";
  return m.plan.daysLeft !== null && m.plan.daysLeft < 0 ? `Package expired on ${m.plan.endsOn}` : `Active until ${m.plan.endsOn}`;
}

// Verification after a scan: who the code names and whether they may come in; then the check-in
// and its confirmation (Scan next member / Done), or why it failed (Scan again / Done)
export default function OwnerVerify() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const code = useOwnerStore((state) => state.scan);
  const setRescan = useOwnerStore((state) => state.setRescan);
  const loadSummary = useOwnerStore((state) => state.loadSummary);
  const [step, setStep] = useState<Step>({ kind: "checking" });
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async () => {
    if (!gymId || !code) return setStep({ kind: "error", message: "Scan a member's QR code first." });
    setStep({ kind: "checking" });
    const result = await owner.verify(await getToken(), gymId, code);
    setStep(result.ok ? { kind: "result", result: result.data } : { kind: "error", message: result.error });
  }, [gymId, code, getToken]);

  useEffect(() => {
    const timer = setTimeout(verify, 0);
    return () => clearTimeout(timer);
  }, [verify]);

  const checkIn = async () => {
    if (!gymId || !code || busy) return;
    setBusy(true);
    const token = await getToken();
    const result = await owner.checkIn(token, gymId, code);
    setBusy(false);
    // Refused at this point (they were checked in meanwhile, say): show why
    if (!result.ok) return setStep({ kind: "error", message: result.error });
    setStep({ kind: "done", visit: result.data.visit });
    loadSummary(token);
  };

  // Back to the Check-in tab, which opens its scanner again (one scanner for the front desk)
  const scanAgain = () => {
    setRescan(true);
    router.back();
  };

  const gymName = step.kind === "result" ? step.result.gym.name : "";
  const result = step.kind === "result" ? step.result : null;
  const member = result?.member ?? null;
  const ok = step.kind === "done" || (result?.eligible ?? false);
  const failed = step.kind === "error" || (result !== null && !result.eligible);

  const title =
    step.kind === "done" ? "Check-in successful" : result?.eligible ? "Member verified" : result ? "Verification failed" : step.kind === "error" ? "Couldn't check in" : "Checking…";
  const message =
    step.kind === "done" ? `${step.visit.member.name} checked in at ${timeLabel(step.visit.checkedInAt)}.` : result?.eligible ? "This member may check in." : result ? (result.message ?? "") : step.kind === "error" ? step.message : "";

  const rows: { label: string; value: string; tone?: "ok" | "bad" }[] = member
    ? [
        { label: "Branch", value: gymName },
        { label: "Membership", value: member.plan?.name ?? roleLabels[member.role] },
        { label: "Status", value: result ? statusLine(result) : "" },
        { label: "Check-in", value: result?.eligible ? "Eligible" : "Not allowed", tone: result?.eligible ? "ok" : "bad" },
      ]
    : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Verification</Text>
        <View className="screen-bar__back" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, flexGrow: 1 }}>
        {step.kind === "checking" ? (
          <ActivityIndicator color={colors.forest} className="mt-10" />
        ) : (
          <>
            <View className="items-center gap-2 pt-4">
              <View className={ok ? "owner-result owner-result--ok" : "owner-result owner-result--bad"}>
                <SymbolView name={ok ? { ios: "checkmark", android: "check", web: "check" } : { ios: "xmark", android: "close", web: "close" }} size={32} tintColor={ok ? colors.leaf : colors.danger} />
              </View>
              <Text className="owner-result__title" accessibilityRole="header">{title}</Text>
              {!!message && <Text className="owner__subtitle text-center">{message}</Text>}
            </View>

            {step.kind === "done" ? (
              <View className="owner-card flex-row items-center gap-3">
                <Avatar member={step.visit.member} size={52} />
                <View className="min-w-0 flex-1">
                  <Text className="friend-row__name">{step.visit.member.name}</Text>
                  <Text className="friend-row__note">Checked in {timeLabel(step.visit.checkedInAt)} · {durationLabel(step.visit.minutes)} so far</Text>
                </View>
              </View>
            ) : member ? (
              <>
                <View className="owner-card flex-row items-center gap-3">
                  <Avatar member={member.member} size={52} />
                  <View className="min-w-0 flex-1">
                    <Text className="friend-row__name">{member.member.name}</Text>
                    <Text className="friend-row__note">{roleLabels[member.role]}{member.joinedAt ? ` · since ${member.joinedAt.slice(0, 10)}` : ""}</Text>
                  </View>
                </View>
                <View className="owner-card" style={{ padding: 0, gap: 0 }}>
                  {rows.map((row, i) => (
                    <View key={row.label} className="flex-row items-center justify-between px-4 py-3" style={i > 0 ? { borderTopWidth: 1, borderColor: colors.creamLine } : undefined}>
                      <Text className="owner-stat__label">{row.label}</Text>
                      {row.tone ? (
                        <View className={row.tone === "ok" ? "owner-badge owner-badge--accent" : "owner-badge owner-badge--danger"}>
                          <Text className="owner-badge__label">{row.value}</Text>
                        </View>
                      ) : (
                        <Text className="friend-row__name" style={{ fontSize: 15, flexShrink: 1, textAlign: "right" }}>{row.value}</Text>
                      )}
                    </View>
                  ))}
                </View>
                {result?.renewalWarning && (
                  <Pressable onPress={() => router.push("/owner/renewals")} className="owner-card owner-card--warning" accessibilityRole="button" accessibilityLabel="Package ends this week. Open Renewals">
                    <Text className="friend-row__name">Package ends this week</Text>
                    <Text className="friend-row__note">Renew it or remind them. Open Renewals ›</Text>
                  </Pressable>
                )}
              </>
            ) : result && !result.eligible ? (
              <View className="owner-card"><Text className="friend-row__note">{result.reason ? refusalTitles[result.reason] : ""}. Nobody was checked in.</Text></View>
            ) : null}

            <View className="flex-1" />
            <View className="gap-3">
              {result?.eligible && member && (
                <Pressable onPress={checkIn} disabled={busy} className="btn-forest" style={{ height: 52, opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`Check in ${member.member.name}`}>
                  {busy ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Check in {member.member.name.split(" ")[0]}</Text>}
                </Pressable>
              )}
              {(step.kind === "done" || failed) && (
                <Pressable onPress={scanAgain} className="btn-forest" style={{ height: 52 }} accessibilityRole="button" accessibilityLabel={step.kind === "done" ? "Scan next member" : "Scan again"}>
                  <Text className="btn-forest__label">{step.kind === "done" ? "Scan next member" : "Scan again"}</Text>
                </Pressable>
              )}
              <Pressable onPress={() => router.back()} className="btn-outline" accessibilityRole="button" accessibilityLabel={result?.eligible ? "Cancel" : "Done"}>
                <Text className="btn-outline__label">{result?.eligible ? "Cancel" : "Done"}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
