import { create } from "zustand";

import { defaultHomeContent, defaultPromotions, sampleNutrition, type HomeContent, type NutritionToday, type Promotion } from "@/data/home";
import { onAccountCleared, sameAccount } from "@/lib/accountScope";
import { fetchActivePromotions, fetchHomeContent } from "@/lib/home";
import { macro, todayIso, type Totals } from "@/lib/macro";
import { weekOf, workoutApi, type WeekActivity } from "@/lib/workoutApi";

// Everything the home screen loads: promotions, labels, quick actions, popular meals and
// the member's nutrition targets. Starts with the bundled defaults so the screen never
// flashes empty, then keeps the last successful server answer for the rest of the session:
// a failed refresh leaves the previous content in place. The freshness window also means a
// screen that mounts or re-renders often never floods the server (every authenticated route
// is rate limited per user). Nothing is written to device storage (see AGENTS.md).

// Don't ask the server again within this long of a successful load
const FRESH_FOR_MS = 60 * 1000;

// Today's workout as Home's hero card shows it (day null on a rest day)
export type HomeWorkout = {
  status: "completed" | "in_progress" | "missed" | "planned" | "rest";
  day: { title: string; minutes: number; exerciseCount: number } | null;
  level: string;
};

type HomeState = {
  promotions: Promotion[];
  content: HomeContent;
  // The member's targets with today's intake (null until the first load finishes)
  nutrition: NutritionToday | null;
  // Today's water against its target (null until loaded, or when Macro has no water target)
  water: { consumedMl: number; targetMl: number } | null;
  // Today's workout and the week's minutes (null without a workout plan, or until loaded)
  workout: HomeWorkout | null;
  activity: WeekActivity | null;
  // "default" until the first successful load, then "server"
  source: "default" | "server";
  loading: boolean;
  // Why the last load failed (the previous content is still shown)
  error: string | null;
  loadedAt: number | null;
  // Loads both parts; `force` ignores the freshness window (pull to refresh, app resumed)
  load: (token: string | null, options?: { force?: boolean }) => Promise<void>;
  // Re-reads today's Macro diary (Home coming back into view)
  refreshIntake: (token: string | null) => Promise<void>;
};

// Today's targets and what was eaten, from the same /api/macro/day call the Macro tab uses,
// so both screens always show the same numbers (null when the day or its targets can't be read)
async function nutritionToday(token: string | null): Promise<NutritionToday | null> {
  const day = await macro.day(token, todayIso());
  if (!day.ok || !day.data.targets) return null;
  const amounts = ({ kcal, proteinG, carbsG, fatG }: Totals) => ({
    calories: Math.round(kcal),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
  });
  return { consumed: amounts(day.data.totals), targets: amounts(day.data.targets), source: "targets" };
}

// The other Home cards: water, today's workout and the week's activity. Each stands on its
// own, so a failure leaves that card out, never the screen.
async function extrasToday(token: string | null) {
  const today = todayIso();
  const [water, home, activity] = await Promise.all([macro.water(token, today), workoutApi.home(token, today, weekOf(today), today), workoutApi.activity(token, today)]);
  return {
    water: water.ok && water.data.targetMl > 0 ? { consumedMl: water.data.consumedMl, targetMl: water.data.targetMl } : null,
    workout: home.ok && home.data.plan
      ? { status: home.data.status, day: home.data.day ? { title: home.data.day.title, minutes: home.data.day.minutes, exerciseCount: home.data.day.exerciseCount } : null, level: home.data.plan.level }
      : null,
    activity: activity.ok ? activity.data : null,
  };
}

export const useHomeStore = create<HomeState>((set, get) => ({
  promotions: defaultPromotions,
  content: defaultHomeContent,
  nutrition: null,
  water: null,
  workout: null,
  activity: null,
  source: "default",
  loading: false,
  error: null,
  loadedAt: null,

  load: async (token, { force = false } = {}) => {
    const { loading, loadedAt } = get();
    if (loading) return;
    if (!force && loadedAt !== null && Date.now() - loadedAt < FRESH_FOR_MS) return;
    set({ loading: true });
    const stillCurrent = sameAccount();
    const [promotions, content, today, extras] = await Promise.all([fetchActivePromotions(token), fetchHomeContent(token), nutritionToday(token), extrasToday(token)]);
    if (!stillCurrent()) return; // signed out meanwhile: these numbers were the previous account's
    set(extras);
    // A failed refresh keeps the last real numbers; the bundled sample only until the first real load
    const nutrition = today ?? get().nutrition ?? sampleNutrition;

    const failed = !promotions.ok ? promotions : !content.ok ? content : null;
    if (failed || !promotions.ok || !content.ok) {
      // Keep the previous content; the timestamp still moves so a failing server isn't hammered
      set({ loading: false, error: failed?.error ?? "Something went wrong. Please try again.", nutrition, loadedAt: Date.now() });
      return;
    }
    set({
      promotions: promotions.data.promotions,
      content: content.data.content,
      nutrition,
      source: "server",
      loading: false,
      error: null,
      loadedAt: Date.now(),
    });
  },

  refreshIntake: async (token) => {
    const stillCurrent = sameAccount();
    const [today, extras] = await Promise.all([nutritionToday(token), extrasToday(token)]);
    if (!stillCurrent()) return;
    set({ ...extras, ...(today ? { nutrition: today } : {}) });
  },
}));

// The member's own numbers go with the account, and the next account loads afresh. The
// promotions and labels are the same for everyone, so they stay.
onAccountCleared(() => useHomeStore.setState({ nutrition: null, water: null, workout: null, activity: null, loading: false, error: null, loadedAt: null }));
