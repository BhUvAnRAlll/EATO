import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { DateSelect } from "@/components/gym/DateSelect";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { TrainerChips } from "@/components/gym/TrainerChips";
import { METHOD_LABEL, daysFromToday, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymMemberDetail, type PayMethod } from "@/lib/gymApi";
import { addDaysIso, latestEndIso, monthsBetween, planEndIso } from "@/lib/gymDates";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › a member › PT: personal training they paid for (the package, its period, the
// trainer it's with, the amount, how). The period is a start and an end date: the start follows
// on from a PT still running (or is today), the end comes from the Duration (whole months), and
// either can be picked by hand. An end date on a whole month writes the Duration back; any other
// end date is kept as picked, with the Duration cleared (the server saves the dates as they are).
export default function GymPersonalTraining() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry } = useGymData(load);
  // The PT package picked from the catalogue, highlighted above the form; editing what it filled in clears it
  const [picked, setPicked] = useState<number | null>(null);
  const [pack, setPack] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  // The period this PT covers, in whole months
  const [duration, setDuration] = useState("1");
  // A start date picked by hand; null until then (the default follows the member's current PT)
  const [startPick, setStartPick] = useState<string | null>(null);
  // An end date picked by hand that isn't a whole number of months from the start; null otherwise
  const [endPick, setEndPick] = useState<string | null>(null);
  // The trainer picked here; until one is picked, the member's current trainer
  const [trainer, setTrainer] = useState<string | null>(null);
  // Back to the member page that opened this form (it re-reads on focus); a second copy of it would
  // sit on top otherwise, and Back then showed the same member twice (QA 2026-11-07)
  const { busy, error, save } = useGymSave(() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/gym/members/[id]", params: { id: String(memberId) } })), "PT added");
  const value = rupeesFromText(amount);
  const length = durationValue(duration);

  // The end date picked sets the Duration to match when it falls on a whole month; otherwise the
  // date is kept as picked and the Duration cleared
  const pickEnd = (start: string, end: string) => {
    const months = monthsBetween(start, end);
    if (months !== null) { setDuration(String(months)); setEndPick(null); return; }
    setDuration("");
    setEndPick(end);
  };
  // A new start date: the end follows the Duration again
  const pickStart = (start: string) => { setStartPick(start); setEndPick(null); };
  const typeDuration = (text: string) => { setPicked(null); setDuration(text); setEndPick(null); };

  const period = (member: GymMemberDetail["member"]) => {
    const followsOn = member.pt?.active ? addDaysIso(member.pt.until, 1) : daysFromToday(0);
    const start = startPick ?? followsOn;
    return { start, end: length === null ? endPick : planEndIso(start, length), followsOn: startPick === null && member.pt?.active ? member.pt.until : null };
  };

  return (
    <GymScreen title="Personal training">
      {result.state === "loading" && <GymLoading label="Loading the member" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (() => {
        const { start, end, followsOn } = period(result.data.member);
        const ready = pack.trim().length >= 2 && value >= 1 && end !== null;
        return (
          <>
            <View className="gym-summary">
              <Text className="gym-tx__name">{result.data.member.name}</Text>
              <Text className="gym-tx__meta">Personal training payment</Text>
            </View>
            <CatalogPicks kind="pt" label="From your PT packages" selected={picked} onPick={(item) => {
                setPicked(item.id);
                setPack(item.name);
                setAmount(String(item.price));
                // A package with a length fills the period too
                if (item.duration) { setDuration(String(item.duration)); setEndPick(null); }
              }} />
            <GymField label="Package" value={pack} onChangeText={(t) => { setPicked(null); setPack(t); }} maxLength={60} placeholder="For example: 12 sessions" />
            <PlanLengthFields duration={duration} onDuration={typeDuration} />
            <View className="flex-row" style={{ gap: 16 }}>
              <View className="min-w-0 flex-1"><DateSelect label="Start date" value={start} onChange={pickStart} min={daysFromToday(-365)} max={daysFromToday(60)} stacked /></View>
              <View className="min-w-0 flex-1"><DateSelect label="End date" value={end} onChange={(iso) => pickEnd(start, iso)} min={start} max={latestEndIso(start)} stacked /></View>
            </View>
            {followsOn && <Text className="gym-tx__meta">{`Follows on from their current PT, which runs until ${shortDate(followsOn)}.`}</Text>}
            <TrainerChips value={trainer ?? result.data.member.pt?.trainer?.id ?? ""} onChange={setTrainer} />
            <GymField label="Amount (₹)" value={amount} onChangeText={(t) => { setPicked(null); setAmount(amountInput(t)); }} keyboardType="number-pad" placeholder="6000" />
            <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
            {error ? <FormAlert message={error} /> : null}
            <SaveButton label="Save PT payment" ready={ready} busy={busy} onPress={() => save((token) => gymApi.personalTraining(token, memberId, { package: pack.trim(), amount: value, method, duration: length ?? 1, ...(startPick !== null ? { startsOn: start } : {}), ...(endPick !== null && end !== null ? { endsOn: end } : {}), trainerId: (trainer ?? result.data.member.pt?.trainer?.id ?? "") || null }))} />
          </>
        );
      })()}
    </GymScreen>
  );
}
