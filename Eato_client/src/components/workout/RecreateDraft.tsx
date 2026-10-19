import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { todayIso } from "@/lib/macro";
import { draftFrom, type Draft } from "@/lib/recreateRules";
import { useSessionToken } from "@/lib/session";
import { workoutApi } from "@/lib/workoutApi";

// The "Rebuild my plan" draft, shared by every step of the flow. Seeded once from the
// member's saved answers; each step edits it and checks its own fields before Continue.

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; trainerManaged: boolean };

type RecreateContext = {
  load: Load;
  draft: Draft;
  update: (change: (draft: Draft) => Draft) => void;
  retry: () => void;
};

const Context = createContext<RecreateContext | null>(null);

export function RecreateDraftProvider({ children }: { children: ReactNode }) {
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [draft, setDraft] = useState<Draft>(() => draftFrom({}));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await workoutApi.recreateInputs(await getToken().catch(() => null), todayIso());
      if (cancelled) return;
      if (!result.ok) return setLoad({ state: "failed", error: result.error });
      setDraft(draftFrom(result.data.answers));
      setLoad({ state: "ready", trainerManaged: result.data.trainerManaged });
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt]);

  const update = useCallback((change: (draft: Draft) => Draft) => setDraft(change), []);
  const retry = useCallback(() => {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return <Context.Provider value={{ load, draft, update, retry }}>{children}</Context.Provider>;
}

export function useRecreateDraft() {
  const value = useContext(Context);
  if (!value) throw new Error("useRecreateDraft must be used inside RecreateDraftProvider");
  return value;
}
