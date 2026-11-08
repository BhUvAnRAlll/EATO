import { useRef, useState } from "react";

import type { ApiResult } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";

// A gym portal form's save: one request at a time, the server's error line on failure, a success
// buzz and `done(data)` on success. The server checks every field again. With `success`, the
// buzz comes with a short HUD line ("Payment recorded"), fixed or worked out from the answer.
export function useGymSave<T>(done: (data: T) => void, success?: string | ((data: T) => string)) {
  const getToken = useSessionToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A ref, not the state: two taps in one frame both see busy === false (a double admission, or
  // an SMS sent and paid for twice)
  const running = useRef(false);
  const save = async (send: (token: string | null) => Promise<ApiResult<T>>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    let result: ApiResult<T>;
    try {
      result = await send(await getToken().catch(() => null));
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (success) hud.success(typeof success === "function" ? success(result.data) : success);
    else haptic.success();
    done(result.data);
  };
  const clearError = () => setError("");
  return { busy, error, save, clearError };
}
