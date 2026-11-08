import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import type { ApiResult } from "@/lib/api";
import { useSessionToken } from "@/lib/session";

export type GymLoad<T> = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: T };

// Reads one gym portal answer each time the screen comes into view (so a payment recorded on
// another screen shows on return), keeping the last answer on screen while it refreshes.
// `refreshing` and `refresh` drive a screen's pull-to-refresh control.
// `load` should be stable (wrap it in useCallback when it depends on params).
export function useGymData<T>(load: (token: string | null) => Promise<ApiResult<T>>) {
  const getToken = useSessionToken();
  const [result, setResult] = useState<GymLoad<T>>({ state: "loading" });
  // The last refresh failed while an older answer stays on screen (Home's sync pill says so)
  const [stale, setStale] = useState(false);
  const latest = useRef(0);
  // The `load` the answer on screen came from: a different one is a new query (another filter, day
  // or search), whose answer must replace the old list, never sit behind it (QA 2026-11-07: a
  // changed filter kept showing the previous filter's rows, for good when the new read failed)
  const shown = useRef<typeof load | null>(null);

  const reload = useCallback(async () => {
    const call = ++latest.current;
    const newQuery = shown.current !== load;
    if (newQuery) setResult({ state: "loading" });
    const answer = await load(await getToken().catch(() => null));
    if (call !== latest.current) return;
    shown.current = load;
    setStale(!answer.ok);
    setResult((current) => (answer.ok ? { state: "ready", data: answer.data } : !newQuery && current.state === "ready" ? current : { state: "failed", error: answer.error }));
  }, [getToken, load]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Pull to refresh (2026-11-07): the spinner at the top while the answer is read again
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const set = useCallback((data: T) => setResult({ state: "ready", data }), []);
  // Changes the answer on screen from whatever it is then (a pull to refresh may have replaced the
  // one a tap saw), so a save never writes an older list back
  const update = useCallback((change: (data: T) => T) => setResult((current) => (current.state === "ready" ? { state: "ready", data: change(current.data) } : current)), []);
  const retry = useCallback(() => {
    setResult({ state: "loading" });
    reload();
  }, [reload]);
  return { result, reload, retry, set, update, stale, refreshing, refresh };
}
