import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import type { ApiResult } from "@/lib/api";
import { useSessionToken } from "@/lib/session";

export type GymLoad<T> = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: T };

// Reads one gym portal answer each time the screen comes into view (so a payment recorded on
// another screen shows on return), keeping the last answer on screen while it refreshes.
// `load` should be stable (wrap it in useCallback when it depends on params).
export function useGymData<T>(load: (token: string | null) => Promise<ApiResult<T>>) {
  const getToken = useSessionToken();
  const [result, setResult] = useState<GymLoad<T>>({ state: "loading" });
  // The last refresh failed while an older answer stays on screen (Home's sync pill says so)
  const [stale, setStale] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const call = ++latest.current;
    const answer = await load(await getToken().catch(() => null));
    if (call !== latest.current) return;
    setStale(!answer.ok);
    setResult((current) => (answer.ok ? { state: "ready", data: answer.data } : current.state === "ready" ? current : { state: "failed", error: answer.error }));
  }, [getToken, load]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const set = useCallback((data: T) => setResult({ state: "ready", data }), []);
  const retry = useCallback(() => {
    setResult({ state: "loading" });
    reload();
  }, [reload]);
  return { result, reload, retry, set, stale };
}
