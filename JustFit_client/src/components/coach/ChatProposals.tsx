import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { ChatProposals as Proposals, MealProposal, PlanSlot, WorkoutProposal } from "@/lib/coach";
import { useSessionToken } from "@/lib/session";
import { proposalKey, useCoachChatStore, type ProposalState } from "@/store/coachChat";
import { useThemeColors } from "@/theme";

// The plan changes a coach reply recommends, as cards under the reply: each meal (what's planned
// now → the coach's dish, its calories and protein) and the workout (days and session length now →
// suggested). Apply puts it in the plan: a meal through the same replace as Swap Meal, with Undo;
// the workout after a confirm inside the card, because it rebuilds the week from today.

const SLOT: Record<PlanSlot, string> = { breakfast: "Breakfast", morning_snack: "Morning snack", lunch: "Lunch", evening_snack: "Evening snack", dinner: "Dinner" };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Monday first, as the plan reads
const days = (weekdays: number[]) => [...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY[d]).join(", ");

function Status({ state, applied, onUndo }: { state?: ProposalState; applied: string; onUndo?: () => void }) {
  const colors = useThemeColors();
  if (state?.status !== "applied") return null;
  return (
    <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={16} tintColor={colors.success} />
        <Text className="coach__hint" style={{ color: colors.success }}>{applied}</Text>
      </View>
      {onUndo && (
        <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button" accessibilityLabel="Undo this change">
          <Text className="home__link">Undo</Text>
        </Pressable>
      )}
    </View>
  );
}

function ApplyButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable onPress={onPress} disabled={busy} className="coach__log coach__log--meal items-center justify-center self-start" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }}>
      {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="coach__log-label">{label}</Text>}
    </Pressable>
  );
}

function MealCard({ turnId, proposal }: { turnId: number; proposal: MealProposal }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const state = useCoachChatStore((s) => s.proposals[proposalKey(turnId, proposal.mealId)]);
  const applyMeal = useCoachChatStore((s) => s.applyMeal);
  const undoMeal = useCoachChatStore((s) => s.undoMeal);
  const { option } = proposal;
  const foods = option.items.map((i) => i.name).join(", ");
  return (
    <View className="coach__meal-card" style={{ gap: 8 }}>
      <Text className="coach__slot-pill-label">{`${SLOT[proposal.slot]} · ${proposal.time}`}</Text>
      <Text className="coach__hint" numberOfLines={1} style={{ textDecorationLine: "line-through" }}>{proposal.current.name}</Text>
      <Text className="coach__meal-name" numberOfLines={2}>{option.name}</Text>
      {foods !== option.name && <Text className="coach__meal-ings" numberOfLines={2}>{foods}</Text>}
      <Text className="coach__hint">{`${Math.round(option.totals.kcal)} kcal · P ${Math.round(option.totals.proteinG)} g (now ${Math.round(proposal.current.totals.kcal)} kcal · P ${Math.round(proposal.current.totals.proteinG)} g)`}</Text>
      {state?.status === "applied" ? (
        <Status state={state} applied="Updated in your meal plan" onUndo={state.undoId ? () => undoMeal(getToken, turnId, proposal.mealId) : undefined} />
      ) : (
        <ApplyButton label="Apply to my meal plan" busy={state?.status === "busy"} onPress={() => applyMeal(getToken, turnId, proposal.mealId, option.id)} />
      )}
      {state?.error && <Text className="coach__hint" style={{ color: colors.danger }}>{state.error}</Text>}
    </View>
  );
}

function WorkoutCard({ turnId, proposal }: { turnId: number; proposal: WorkoutProposal }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const state = useCoachChatStore((s) => s.proposals[proposalKey(turnId, "workout")]);
  const applyWorkout = useCoachChatStore((s) => s.applyWorkout);
  const [confirming, setConfirming] = useState(false);
  return (
    <View className="coach__meal-card" style={{ gap: 8 }}>
      <Text className="coach__slot-pill-label">Workout</Text>
      <Text className="coach__hint" numberOfLines={2} style={{ textDecorationLine: "line-through" }}>{`${days(proposal.current.weekdays)} · ${proposal.current.sessionMinutes} min`}</Text>
      <Text className="coach__meal-name" numberOfLines={2}>{`${days(proposal.weekdays)} · ${proposal.sessionMinutes} min`}</Text>
      <Text className="coach__hint">{`${proposal.weekdays.length} ${proposal.weekdays.length === 1 ? "day" : "days"} a week`}</Text>
      {state?.status === "applied" ? (
        <Status state={state} applied="Your workout plan is updated" />
      ) : confirming ? (
        <View style={{ gap: 8 }}>
          <Text className="coach__meal-ings">This makes a new workout week from today. Your past sessions stay in your history.</Text>
          <View className="flex-row items-center" style={{ gap: 16 }}>
            <ApplyButton label="Update my workout" busy={state?.status === "busy"} onPress={() => applyWorkout(getToken, turnId, proposal.weekdays, proposal.sessionMinutes)} />
            {state?.status !== "busy" && (
              <Pressable onPress={() => setConfirming(false)} hitSlop={8} accessibilityRole="button">
                <Text className="home__link" style={{ color: colors.muted }}>Cancel</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : (
        <ApplyButton label="Apply to my workout" busy={false} onPress={() => setConfirming(true)} />
      )}
      {state?.error && <Text className="coach__hint" style={{ color: colors.danger }}>{state.error}</Text>}
    </View>
  );
}

export function ChatProposals({ turnId, proposals }: { turnId: number; proposals: Proposals }) {
  if (proposals.meals.length === 0 && !proposals.workout) return null;
  return (
    <View style={{ gap: 10, maxWidth: "92%" }}>
      {proposals.meals.map((meal) => (
        <MealCard key={meal.mealId} turnId={turnId} proposal={meal} />
      ))}
      {proposals.workout && <WorkoutCard turnId={turnId} proposal={proposals.workout} />}
    </View>
  );
}
