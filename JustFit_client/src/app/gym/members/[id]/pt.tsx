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
import { gymApi, type GymMemberDetail, type PayMethod, type PlanUnit } from "@/lib/gymApi";
import { addDaysIso, latestEndIso, lengthBetween, planEndIso } from "@/lib/gymDates";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › a member › PT: personal training they paid for (the package, its period, the
// trainer it's with, the amount, how). The period is a start and an end date: the start follows
// on from a PT still running (or is today), the end comes from the Duration, and either can be
// picked by hand. Picking an end date writes the Duration back (whole months, else days).
export default function GymPersonalTraining() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry } = useGymData(load);
  const [pack, setPack] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  // The period this PT covers
  const [unit, setUnit] = useState<PlanUnit>("months");
  const [duration, setDuration] = useState("1");
  // A start date picked by hand; null until then (the default follows the member's current PT)
  const [startPick, setStartPick] = useState<string | null>(null);
  // The trainer picked here; until one is picked, the member's current trainer
  const [trainer, setTrainer] = useState<string | null>(null);
  const { busy, error, save } = useGymSave(() => router.replace({ pathname: "/gym/members/[id]", params: { id: String(memberId) } }));
  const value = rupeesFromText(amount);
  const length = durationValue(duration, unit);

  // The end date picked sets the Duration to match; a span that fits neither whole months nor
  // 365 days clears it, so the hint under Duration says what's allowed
  const pickEnd = (start: string, end: string) => {
    const fit = lengthBetween(start, end);
    if (fit) { setUnit(fit.unit); setDuration(String(fit.duration)); return; }
    setDuration("");
  };

  const period = (member: GymMemberDetail["member"]) => {
    const followsOn = member.pt?.active ? addDaysIso(member.pt.until, 1) : daysFromToday(0);
    const start = startPick ?? followsOn;
    return { start, end: length === null ? null : planEndIso(start, length, unit), followsOn: startPick === null && member.pt?.active ? member.pt.until : null };
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
            <CatalogPicks kind="pt" label="From your PT packages" onPick={(item) => {
                setPack(item.name);
                setAmount(String(item.price));
                // A package with a length fills the period too
                if (item.duration && item.unit) { setUnit(item.unit); setDuration(String(item.duration)); }
              }} />
            <GymField label="Package" value={pack} onChangeText={setPack} maxLength={60} placeholder="For example: 12 sessions" />
            <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />
            <View className="flex-row" style={{ gap: 16 }}>
              <View className="min-w-0 flex-1"><DateSelect label="Start date" value={start} onChange={setStartPick} min={daysFromToday(-365)} max={daysFromToday(60)} stacked /></View>
              <View className="min-w-0 flex-1"><DateSelect label="End date" value={end} onChange={(iso) => pickEnd(start, iso)} min={start} max={latestEndIso(start)} stacked /></View>
            </View>
            {followsOn && <Text className="gym-tx__meta">{`Follows on from their current PT, which runs until ${shortDate(followsOn)}.`}</Text>}
            <TrainerChips value={trainer ?? result.data.member.pt?.trainer?.id ?? ""} onChange={setTrainer} />
            <GymField label="Amount (₹)" value={amount} onChangeText={(t) => setAmount(amountInput(t))} keyboardType="number-pad" placeholder="6000" />
            <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
            {error ? <FormAlert message={error} /> : null}
            <SaveButton label="Save PT payment" ready={ready} busy={busy} onPress={() => save((token) => gymApi.personalTraining(token, memberId, { package: pack.trim(), amount: value, method, unit, duration: length ?? 1, startsOn: start, endsOn: end ?? start, trainerId: (trainer ?? result.data.member.pt?.trainer?.id ?? "") || null }))} />
          </>
        );
      })()}
    </GymScreen>
  );
}
