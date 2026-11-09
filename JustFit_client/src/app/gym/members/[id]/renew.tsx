import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL, daysFromToday, planLabel, rupees, shortDate } from "@/data/gymDashboard";
import { DueByField } from "@/components/gym/DueByField";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { gymApi, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › a member › Renew: the new plan follows on from the current one (the server works out
// the dates); what isn't paid now is added to what they owe
export default function GymRenew() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry } = useGymData(load);
  // The catalogue plan picked, highlighted above the form; editing what it filled in clears it
  const [picked, setPicked] = useState<number | null>(null);
  const [duration, setDuration] = useState("1");
  const [fee, setFee] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  const [dueBy, setDueBy] = useState<string | null>(() => daysFromToday(7));
  // Back to the member page that opened this form (it re-reads on focus); a second copy of it would
  // sit on top otherwise, and Back then showed the same member twice (QA 2026-11-07)
  const { busy, error, save } = useGymSave(() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/gym/members/[id]", params: { id: String(memberId) } })), "Membership renewed");
  const feeValue = rupeesFromText(fee);
  const paidValue = rupeesFromText(paid);
  const length = durationValue(duration);
  const leftOwed = feeValue >= 1 && paidValue >= 1 && paidValue < feeValue;
  const dueByIso = dueBy;
  const ready = (!leftOwed || dueByIso !== null) && length !== null && feeValue >= 1 && paidValue >= 1 && paidValue <= feeValue;

  return (
    <GymScreen title="Renewal">
      {result.state === "loading" && <GymLoading label="Loading the member" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        <>
          <View className="gym-summary">
            <Text className="gym-tx__name">{result.data.member.name}</Text>
            <Text className="gym-tx__meta">{`${planLabel(result.data.member.planLength.duration, result.data.member.planLength.unit)} · until ${shortDate(result.data.member.expiresOn)}${result.data.member.due > 0 ? ` · due ${rupees(result.data.member.due)}` : ""}`}</Text>
          </View>
          <CatalogPicks kind="plan" label="From your plans" selected={picked} onPick={(item) => { setPicked(item.id); if (item.duration) setDuration(String(item.duration)); setFee(String(item.price)); setPaid(String(item.price)); }} />
          <PlanLengthFields duration={duration} onDuration={(t) => { setPicked(null); setDuration(t); }} />
          <GymField label="Plan fee (₹)" icon="banknote" pinLabel value={fee} onChangeText={(t) => { setPicked(null); setFee(amountInput(t)); }} keyboardType="number-pad" placeholder="4500" />
          <GymField label="Paid now (₹)" icon="indian-rupee" pinLabel value={paid} onChangeText={(t) => setPaid(amountInput(t))} keyboardType="number-pad" placeholder="3000" />
          <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
          {leftOwed && <DueByField value={dueBy} onChange={setDueBy} />}
          {ready && feeValue > paidValue && <Text className="gym-tx__meta">{`${rupees(feeValue - paidValue)} will be added to their due${dueByIso ? `, due ${shortDate(dueByIso)}` : ""}.`}</Text>}
          {paidValue > feeValue && <Text className="gym-tx__meta">{"The amount paid can't be more than the plan fee."}</Text>}
          {error ? <FormAlert message={error} /> : null}
          <SaveButton label="Save renewal" ready={ready} busy={busy} onPress={() => save((token) => gymApi.renew(token, memberId, { duration: length ?? 1, planId: picked ?? undefined, fee: feeValue, paid: paidValue, method, dueBy: leftOwed && dueByIso ? dueByIso : "" }))} />
        </>
      )}
    </GymScreen>
  );
}
